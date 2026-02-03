const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// --- CONEXÃO COM O BANCO DE DADOS (SUPABASE) ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configurações Whatswave (Centralizado)
const WHATS_CONFIG = {
    baseUrl: 'https://api.whatswave.com.br/api',
    instanceId: 'Nati',
    token: process.env.WHATS_TOKEN // Recomendo colocar no .env do Render
};

const ID_ZONA_ESPERA = 'f7ed71fa-4c8c-47f9-8ed6-7e92327f3f82';

app.get('/', (req, res) => {
  res.send('🚀 CronosFlow Mestre (Nati IA + Automação): ONLINE');
});

// ==================================================================
// 🔐 1. MÓDULO ADMINISTRATIVO (Licenças)
// ==================================================================

app.post('/api/ativar-licenca', async (req, res) => {
  const { chave, userId, email } = req.body;
  try {
    const { data: licenca } = await supabase.from('licencas_broosaas').select('*').eq('chave', chave).single();
    if (!licenca) return res.status(404).json({ erro: 'Chave inválida.' });
    if (licenca.status === 'USADA') return res.status(409).json({ erro: 'Chave já utilizada.' });

    await supabase.from('licencas_broosaas').update({
        status: 'USADA', ativado_por: userId, email_vinculado: email, data_ativacao: new Date()
    }).eq('chave', chave);

    res.json({ sucesso: true, mensagem: 'Sistema ativado!' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao ativar licença.' });
  }
});

// ==================================================================
// 🤖 2. MÓDULO DE INTELIGÊNCIA ARTIFICIAL (Nati IA)
// ==================================================================

// IA: Realizar Agendamento Automático (Com Filtro de Log)
app.post('/api/ia/agendar', async (req, res) => {
  const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id } = req.body;

  try {
    // A. Lógica de Cliente
    let { data: cliente } = await supabase.from('clientes').select('id').eq('telefone', cliente_telefone).single();
    if (!cliente) {
      const { data: novo } = await supabase.from('clientes').insert([{ nome: cliente_nome, telefone: cliente_telefone }]).select().single();
      cliente = novo;
    }

    // B. Lógica de Tempo e Valor
    const { data: servico } = await supabase.from('servicos').select('duracao_min, valor, nome').eq('id', servico_id).single();
    const [h, m] = horario_inicio.split(':');
    const d = new Date(); d.setHours(h, m, 0);
    d.setMinutes(d.getMinutes() + servico.duracao_min);
    const horario_fim = d.toTimeString().slice(0,5);

    // C. Inserção
    const { error: errAgenda } = await supabase.from('agendamentos').insert([{
        cliente_id: cliente.id,
        cliente_nome: cliente_nome,
        data: data,
        hora_inicio: horario_inicio,
        hora_fim: horario_fim,
        servico_id: servico_id,
        valor_cobrado: servico.valor,
        status: 'agendado',
        notas: 'Agendamento via IA (WhatsApp)',
        origem: 'Nati IA',
        cliente_telefone: cliente_telefone
    }]);

    if (errAgenda) throw errAgenda;

    // --- FILTRO DE LIMPEZA NATI ---
    let respostaIA = `Agendado com sucesso para ${cliente_nome}! ✨`; // Aqui viria o texto da sua IA
    const respostaLimpa = respostaIA.replace(/Chamando ferramenta.*/gs, '').trim();

    res.json({ sucesso: true, message: respostaLimpa });

  } catch (err) {
    res.status(500).json({ erro: "Falha ao agendar via IA." });
  }
});

// ==================================================================
// ⚡ 3. WEBHOOKS (Automação Reativa)
// ==================================================================

// Confirmação Automática ao Mover Card
app.post('/api/webhooks/confirmar', async (req, res) => {
    const { record, old_record } = req.body;

    // Se saiu da Zona de Espera para um profissional real
    if (old_record.profissional_id === ID_ZONA_ESPERA && record.profissional_id !== ID_ZONA_ESPERA) {
        
        const dataF = record.data.split('-').reverse().join('/');
        const msg = `Olá, ${record.cliente_nome}! ✨ Passando para confirmar que seu horário foi reservado para o dia ${dataF} às ${record.hora_inicio}. Te esperamos! 💖`;

        try {
            await axios.post(`${WHATS_CONFIG.baseUrl}/messages/sendText`, {
                number: record.cliente_telefone,
                text: msg,
                time_delay: 2
            }, { headers: { 'Authorization': `Bearer ${WHATS_CONFIG.token}` } });
            console.log(`✅ Whats automático enviado para ${record.cliente_nome}`);
        } catch (e) {
            console.error('❌ Erro Webhook Whats:', e.message);
        }
    }
    res.status(200).send('OK');
});

// ==================================================================
// 💾 4. MÓDULO DE SEGURANÇA (Backup)
// ==================================================================

app.get('/api/backup/gerar', async (req, res) => {
    const [ags, cli, ser, pro] = await Promise.all([
        supabase.from('agendamentos').select('*'),
        supabase.from('clientes').select('*'),
        supabase.from('servicos').select('*'),
        supabase.from('profissionais').select('*')
    ]);
    res.json({ metadata: { gerado_em: new Date() }, dados: { agendamentos: ags.data, clientes: cli.data, servicos: ser.data, profissionais: pro.data } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor Mestre CronosFlow na porta ${PORT}`));
