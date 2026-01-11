const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

// Função auxiliar para somar minutos a um horário HH:MM
const somarMinutos = (horario, minutos) => {
    let [h, m] = horario.split(':').map(Number);
    let data = new Date(2026, 0, 1, h, m + minutos);
    return `${data.getHours().toString().padStart(2, '0')}:${data.getMinutes().toString().padStart(2, '0')}:00`;
};

// CONSULTAR
app.get('/api/ia/consultar', async (req, res) => {
    const { data, funcionario_id } = req.query;
    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio')
            .eq('data', data)
            .eq('profissional_id', funcionario_id);

        if (error) throw error;
        const todos = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        res.status(200).json({ disponiveis: todos.filter(h => !ocupados.includes(h)) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AGENDAR COM DURAÇÃO REAL E TRAVA
app.post('/api/ia/agendar', async (req, res) => {
    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id } = req.body;

    try {
        // 1. Buscar a duração real do serviço no banco
        const { data: servico, error: errS } = await supabase
            .from('servicos')
            .select('duracao_min')
            .eq('id', servico_id)
            .single();
        
        if (errS || !servico) throw new Error("Serviço não encontrado.");

        // 2. Calcular hora_fim real
        const hora_fim = somarMinutos(horario_inicio, servico.duracao_min);

        // 3. Checar se o horário já está ocupado (Trava de segurança)
        const { data: existe, error: errC } = await supabase
            .from('agendamentos')
            .select('id')
            .eq('data', data)
            .eq('hora_inicio', `${horario_inicio}:00`)
            .eq('profissional_id', funcionario_id);

        if (existe && existe.length > 0) {
            return res.status(400).json({ success: false, message: "Este horário já foi preenchido." });
        }

        // 4. Inserir agendamento
        const { error: errI } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_nome, cliente_telefone, data, 
                hora_inicio: `${horario_inicio}:00`, 
                hora_fim, 
                servico_id, 
                profissional_id: funcionario_id,
                status: 'agendado'
            }]);

        if (errI) throw errI;
        res.status(200).json({ success: true, message: `Agendado! Duração: ${servico.duracao_min}min.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor v1.1 rodando`));
