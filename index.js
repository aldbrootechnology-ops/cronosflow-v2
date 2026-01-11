const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.text({ type: 'application/json' })); 
app.use(express.json());

// Função para limpar JSON sujo vindo da IA/WhatsApp
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

// CONSULTAR HORÁRIOS
app.all('/api/ia/consultar', async (req, res) => {
    let dados = limparDados(req.body);
    if (!dados || Object.keys(dados).length === 0) dados = req.query;

    const { data, funcionario_id } = dados;

    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') 
            .eq('data', data)
            .eq('profissional_id', funcionario_id);

        if (error) throw error;

        const todosHorarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        const disponiveis = todosHorarios.filter(h => !ocupados.includes(h));

        res.status(200).json({ disponiveis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AGENDAR SERVIÇO (Calculando hora_fim para evitar erro 500)
app.all('/api/ia/agendar', async (req, res) => {
    let dados = limparDados(req.body);
    if (!dados || Object.keys(dados).length === 0) dados = req.query;

    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id } = dados;

    // Lógica simples para calcular hora_fim (horario_inicio + 1 hora)
    let hora = parseInt(horario_inicio.split(':')[0]);
    let minuto = horario_inicio.split(':')[1];
    let hora_fim = `${(hora + 1).toString().padStart(2, '0')}:${minuto}:00`;

    try {
        const { error } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_nome, 
                cliente_telefone, 
                data, 
                hora_inicio: `${horario_inicio}:00`, 
                hora_fim: hora_fim, // Agora o banco aceita pois não é mais nulo
                servico_id, 
                profissional_id: funcionario_id,
                status: 'agendado'
            }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Agendamento realizado!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => res.send('🚀 Cronosflow Backend Online!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
