const express = require('express');
const { createClient } = require('@supabase/supabase-js'); // Corrigido aqui
const cors = require('cors');

const app = express();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// Rota Consultar
app.get('/api/ia/consultar', async (req, res) => {
    const { data, funcionario_id } = req.query;
    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('horario_inicio')
            .eq('data', data)
            .eq('funcionario_id', funcionario_id);

        if (error) throw error;
        const todos = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.horario_inicio.substring(0, 5));
        const disponiveis = todos.filter(h => !ocupados.includes(h));
        res.status(200).json({ disponiveis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota Agendar
app.post('/api/ia/agendar', async (req, res) => {
    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id } = req.body;
    try {
        const { error } = await supabase.from('agendamentos').insert([{ 
            cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id 
        }]);
        if (error) throw error;
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
