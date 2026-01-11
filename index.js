const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.text({ type: 'application/json' })); 
app.use(express.json());

// Função de limpeza para o JSON do WhatsApp/IA
const limparDados = (dadosBrutos) => {
    if (typeof dadosBrutos === 'string') {
        try {
            const stringLimpa = dadosBrutos.trim().replace(/^"+|"+$/g, '').replace(/\\"/g, '"');
            return JSON.parse(stringLimpa);
        } catch (e) {
            try { return JSON.parse(dadosBrutos); } catch (err) { return {}; }
        }
    }
    return dadosBrutos;
};

// ROTA 1: CONSULTAR AGENDA
app.all('/api/ia/consultar', async (req, res) => {
    let dados = limparDados(req.body);
    if (!dados || Object.keys(dados).length === 0) dados = req.query;

    const { data, funcionario_id } = dados;

    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') // Nome real da coluna
            .eq('data', data)
            .eq('profissional_id', funcionario_id); // Coluna correta conforme dump SQL

        if (error) throw error;

        const todosHorarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        
        // Formata HH:MM:SS do banco para HH:MM
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        const disponiveis = todosHorarios.filter(h => !ocupados.includes(h));

        res.status(200).json({ disponiveis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROTA 2: AGENDAR SERVIÇO
app.all('/api/ia/agendar', async (req, res) => {
    let dados = limparDados(req.body);
    if (!dados || Object.keys(dados).length === 0) dados = req.query;

    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id } = dados;

    try {
        const { error } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_nome, 
                cliente_telefone, 
                data, 
                hora_inicio: horario_inicio, // Mapeado para o nome real
                servico_id, 
                profissional_id: funcionario_id // Mapeado para o nome real
            }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Agendado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota de status para ver no navegador
app.get('/', (req, res) => res.send('🚀 Cronosflow Backend Online e Conectado!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
