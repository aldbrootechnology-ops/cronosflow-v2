const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

// Conexão Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());

/**
 * MIDDLEWARE DE LIMPEZA ROBUSTA (Anti-Erro de Sintaxe WhatsWave)
 * Captura o texto bruto e extrai o JSON, limpando lixo e aspas extras
 */
app.use(express.text({ type: 'application/json' })); 

app.use((req, res, next) => {
    if (typeof req.body === 'string' && req.body.trim().length > 0) {
        let corpo = req.body.trim();
        
        // Remove aspas externas (duplas ou triplas) que a IA às vezes injeta
        corpo = corpo.replace(/^["']+|["']+$/g, '');

        try {
            // Tenta o parse direto tratando escapes
            const tratada = corpo.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            req.body = JSON.parse(tratada);
        } catch (e) {
            // Fallback: busca apenas o conteúdo entre chaves { }
            try {
                const match = corpo.match(/\{[\s\S]*\}/);
                if (match) {
                    req.body = JSON.parse(match[0]);
                }
            } catch (err2) {
                console.error("❌ Falha crítica no JSON. Recebido:", corpo);
                req.body = {}; 
            }
        }
    }
    next();
});

app.use(express.json());

// CONFIGURAÇÃO: ID da Zona de Espera como padrão
const ID_ZONA_ESPERA = 'f7ed71fa-4c8c-47f9-8ed6-7e92327f3f82';

// Função auxiliar para limpar sujeira de campos e converter datas
const limparCampo = (valor) => {
    if (typeof valor !== 'string') return valor;
    // Remove chaves { }, aspas " e espaços extras que a IA envia por erro
    let limpo = valor.replace(/[{}""\s]/g, '');
    
    // Converte data DD/MM/AAAA para AAAA-MM-DD para o banco aceitar
    if (limpo.includes('/')) {
        const partes = limpo.split('/');
        if (partes.length === 3) {
            return `${partes[2]}-${partes[1]}-${partes[0]}`;
        }
    }
    return limpo;
};

// ------------------------------------------------------------------
// ROTA: CONSULTAR DISPONIBILIDADE
// ------------------------------------------------------------------
app.all('/api/ia/consultar', async (req, res) => {
    const dados = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    
    // Limpeza de segurança na data
    const dataBusca = limparCampo(dados.data || dados.date);
    // Força sempre a Zona de Espera no backend para evitar erros da IA
    const funcionario_id = ID_ZONA_ESPERA;

    if (!dataBusca || dataBusca === 'undefined') {
        return res.status(400).json({ error: "Data não identificada ou malformada." });
    }

    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') 
            .eq('data', dataBusca)
            .eq('profissional_id', funcionario_id)
            .neq('status', 'cancelado');

        if (error) throw error;

        const todosHorarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        const disponiveis = todosHorarios.filter(h => !ocupados.includes(h));

        res.status(200).json({ disponiveis });
    } catch (error) {
        console.error("Erro Consulta:", error.message);
        res.status(500).json({ error: "Erro ao acessar agenda." });
    }
});

// ------------------------------------------------------------------
// ROTA: REALIZAR AGENDAMENTO
// ------------------------------------------------------------------
app.all('/api/ia/agendar', async (req, res) => {
    const dados = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    
    // Limpeza profunda de todos os parâmetros recebidos
    const cliente_nome = dados.cliente_nome ? dados.cliente_nome.replace(/[{}""\\]/g, '').trim() : "Cliente Whats";
    const dataAgendamento = limparCampo(dados.data);
    const horario_inicio = limparCampo(dados.horario_inicio || dados.hora);
    const servico_id = limparCampo(dados.servico_id);
    const funcionario_id = ID_ZONA_ESPERA;

    if (!dataAgendamento || !horario_inicio) {
        return res.status(400).json({ error: "Data ou horário ausentes." });
    }

    try {
        // Cálculo automático de hora_fim (Duração padrão 1h)
        let [hora, minuto] = horario_inicio.split(':');
        let hora_fim = `${(parseInt(hora) + 1).toString().padStart(2, '0')}:${minuto}:00`;

        const { error } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_nome, 
                data: dataAgendamento, 
                hora_inicio: horario_inicio.length === 5 ? `${horario_inicio}:00` : horario_inicio, 
                hora_fim: hora_fim,
                servico_id: servico_id || null, 
                profissional_id: funcionario_id,
                status: 'agendado',
                origem: 'Nati IA'
            }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Reserva realizada na Zona de Espera!' });
    } catch (error) {
        console.error("Erro Agendamento:", error.message);
        res.status(500).json({ error: "Erro ao gravar agendamento." });
    }
});

app.get('/', (req, res) => res.send('🚀 Cronosflow Backend Robust V3.0 Online!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
