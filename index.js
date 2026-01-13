const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

// Conexão Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());

/**
 * MIDDLEWARE CRÍTICO: Captura o JSON sujo do WhatsWave
 * Se o WhatsWave enviar ""{\"data\"..."", o servidor limpa as aspas extras
 */
app.use(express.text({ type: 'application/json' })); 

app.use((req, res, next) => {
    if (typeof req.body === 'string' && req.body.trim().startsWith('"')) {
        try {
            // Remove aspas duplas externas e desescapa a string vinda da IA
            const cleaned = req.body.trim().replace(/^"+|"+$/g, '').replace(/\\"/g, '"');
            req.body = JSON.parse(cleaned);
        } catch (e) {
            console.error("Erro ao limpar JSON sujo:", e);
        }
    } else if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
        try {
            req.body = JSON.parse(req.body);
        } catch (e) {}
    }
    next();
});

app.use(express.json());

// CONFIGURAÇÃO: ID da Zona de Espera como padrão
const ID_ZONA_ESPERA = 'f7ed71fa-4c8c-47f9-8ed6-7e92327f3f82';

// CONSULTAR HORÁRIOS
app.all('/api/ia/consultar', async (req, res) => {
    const dados = (req.method === 'POST') ? req.body : req.query;
    
    // Se a IA não enviar o ID, usamos a Zona de Espera automaticamente
    const data = dados.data;
    const funcionario_id = dados.funcionario_id || ID_ZONA_ESPERA;

    if (!data) {
        return res.status(400).json({ error: "O campo 'data' é obrigatório." });
    }

    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') 
            .eq('data', data)
            .eq('profissional_id', funcionario_id)
            .neq('status', 'cancelado');

        if (error) throw error;

        const todosHorarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        const disponiveis = todosHorarios.filter(h => !ocupados.includes(h));

        // Retornamos os disponíveis para a IA informar ao cliente
        res.status(200).json({ disponiveis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AGENDAR SERVIÇO
app.all('/api/ia/agendar', async (req, res) => {
    const dados = (req.method === 'POST') ? req.body : req.query;
    
    const { cliente_nome, data, horario_inicio, servico_id } = dados;
    const funcionario_id = dados.funcionario_id || ID_ZONA_ESPERA;

    if (!cliente_nome || !data || !horario_inicio) {
        return res.status(400).json({ error: "Dados incompletos para agendamento." });
    }

    // Cálculo automático de hora_fim (horario_inicio + 1 hora)
    let [hora, minuto] = horario_inicio.split(':');
    let hora_fim = `${(parseInt(hora) + 1).toString().padStart(2, '0')}:${minuto}:00`;

    try {
        const { error } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_nome, 
                data, 
                hora_inicio: `${horario_inicio}:00`, 
                hora_fim: hora_fim,
                servico_id: servico_id || null, 
                profissional_id: funcionario_id,
                status: 'agendado',
                origem: 'Nati IA'
            }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Agendamento realizado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => res.send('🚀 Cronosflow Backend V2 Online!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
