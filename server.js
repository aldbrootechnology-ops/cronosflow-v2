const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware de Segurança e JSON
app.use(cors()); // Em produção, restrinja ao domínio do seu site
app.use(express.json());

// --- CONEXÃO COM O BANCO DE DADOS (SUPABASE) ---
// Certifique-se de que o arquivo .env tem as chaves corretas
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rota de Teste de Vida
app.get('/', (req, res) => {
  res.send('🚀 Sistema CronosFlow (Supabase + IA): ONLINE');
});

// ==================================================================
// 🔐 1. MÓDULO ADMINISTRATIVO (Site e Licenças)
// ==================================================================

// Ativar Licença (Migrado do seu código original)
app.post('/api/ativar-licenca', async (req, res) => {
  const { chave, userId, email } = req.body;
  try {
    // Verifica licença
    const { data: licenca } = await supabase
      .from('licencas_broosaas')
      .select('*')
      .eq('chave', chave)
      .single();

    if (!licenca) return res.status(404).json({ erro: 'Chave inválida.' });
    if (licenca.status === 'USADA') return res.status(409).json({ erro: 'Chave já utilizada.' });

    // Atualiza licença e cria configuração do cliente
    await supabase.from('licencas_broosaas').update({
        status: 'USADA', ativado_por: userId, email_vinculado: email, data_ativacao: new Date()
    }).eq('chave', chave);

    // Cria registro na tabela de clientes (admin) se necessário
    // (Lógica opcional dependendo de como você gerencia os donos de clínica)
    
    res.json({ sucesso: true, mensagem: 'Sistema ativado com sucesso!' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao ativar licença.' });
  }
});

// Listar Agendamentos (Para o calendário do Admin)
app.get('/api/agendamentos', async (req, res) => {
  // Tenta usar a View consolidada se existir, senão busca da tabela bruta
  const { data, error } = await supabase.from('agendamentos').select('*'); // ou 'vw_agenda_consolidada'
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ==================================================================
// 🤖 2. MÓDULO DE INTELIGÊNCIA ARTIFICIAL (WhatsApp)
// ==================================================================

// IA: Consultar Disponibilidade (Lê sua View Otimizada)
app.get('/api/ia/disponibilidade', async (req, res) => {
  const { data, profissional_id } = req.query; // Ex: ?data=2024-05-20

  if (!data) return res.status(400).json({ erro: 'Data obrigatória' });

  try {
    // Consulta a VIEW 'vw_disponibilidade_diaria' que você criou
    let query = supabase
      .from('vw_disponibilidade_diaria')
      .select('horarios_livres, profissional_nome');
      
    query = query.eq('data', data);
    if (profissional_id) query = query.eq('profissional_id', profissional_id);

    const { data: resultado, error } = await query;

    if (error) throw error;
    res.json(resultado); // Retorna: { horarios_livres: ["09:00", "15:00"] }
  } catch (err) {
    console.error("Erro IA:", err);
    res.status(500).json({ erro: "Erro ao calcular disponibilidade." });
  }
});

// IA: Realizar Agendamento Automático
app.post('/api/ia/agendar', async (req, res) => {
  const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id } = req.body;

  try {
    // A. Busca ou Cria Cliente pelo Telefone (Chave única do WhatsApp)
    let { data: cliente } = await supabase
      .from('clientes')
      .select('id')
      .eq('telefone', cliente_telefone) // Ajuste se a coluna for 'celular' ou outra
      .single();

    if (!cliente) {
      const { data: novo, error: errCli } = await supabase
        .from('clientes')
        .insert([{ nome: cliente_nome, telefone: cliente_telefone }])
        .select()
        .single();
      if (errCli) throw errCli;
      cliente = novo;
    }

    // B. Pega detalhes do serviço para calcular hora fim
    const { data: servico } = await supabase
      .from('servicos')
      .select('duracao_min, valor')
      .eq('id', servico_id)
      .single();

    if (!servico) return res.status(400).json({ erro: "Serviço inválido" });

    // C. Calcula Hora Fim
    const [h, m] = horario_inicio.split(':');
    const d = new Date(); d.setHours(h, m, 0);
    d.setMinutes(d.getMinutes() + servico.duracao_min);
    const horario_fim = d.toTimeString().slice(0,5);

    // D. Insere Agendamento (Usando suas colunas do tabelas.txt)
    const { error: errAgenda } = await supabase.from('agendamentos').insert([{
        cliente_id: cliente.id,
        cliente_nome: cliente_nome, // Redundância para facilitar leitura
        data: data,
        hora_inicio: horario_inicio,
        hora_fim: horario_fim,
        servico_id: servico_id,
        valor_cobrado: servico.valor,
        status: 'agendado',
        notas: 'Agendamento via IA (WhatsApp)',
        origem: 'whatsapp_bot'
    }]);

    if (errAgenda) throw errAgenda;

    res.json({ sucesso: true, mensagem: "Agendamento realizado com sucesso!" });

  } catch (err) {
    console.error("Erro Agendamento IA:", err);
    res.status(500).json({ erro: "Falha ao agendar via IA." });
  }
});

// ==================================================================
// 💾 3. MÓDULO DE SEGURANÇA (Backup)
// ==================================================================

app.get('/api/backup/gerar', async (req, res) => {
    // Busca dados brutos para gerar o JSON de segurança
    const [agendamentos, clientes, servicos, profissionais] = await Promise.all([
        supabase.from('agendamentos').select('*'),
        supabase.from('clientes').select('*'),
        supabase.from('servicos').select('*'),
        supabase.from('profissionais').select('*')
    ]);

    res.json({
        metadata: { gerado_em: new Date(), sistema: "CronosFlow v2" },
        dados: {
            agendamentos: agendamentos.data,
            clientes: clientes.data,
            servicos: servicos.data,
            profissionais: profissionais.data
        }
    });
});

// Inicia Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor Mestre rodando na porta ${PORT}`);
});