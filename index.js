const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

// Helper para calcular fim do serviço
const calcularHoraFim = (horaInicio, duracaoMin) => {
    const [h, m] = horaInicio.split(':').map(Number);
    const totalMinutos = h * 60 + m + parseInt(duracaoMin);
    const horasFim = Math.floor(totalMinutos / 60);
    const minutosFim = totalMinutos % 60;
    return `${horasFim.toString().padStart(2, '0')}:${minutosFim.toString().padStart(2, '0')}:00`;
};

// CONSULTA DE HORÁRIOS
app.get('/api/ia/consultar', async (req, res) => {
    const { data, funcionario_id } = req.query;
    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio')
            .eq('data', data)
            .eq('profissional_id', funcionario_id)
            .neq('status', 'cancelado');

        if (error) throw error;
        const grade = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        res.status(200).json({ disponiveis: grade.filter(h => !ocupados.includes(h)) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AGENDAMENTO COM CRM E MARCAÇÃO DE IA
app.post('/api/ia/agendar', async (req, res) => {
    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id } = req.body;

    try {
        // 1. CRM: Buscar ou Criar Cliente
        let cliente_id;
        const { data: clienteExistente } = await supabase
            .from('clientes')
            .select('id')
            .eq('telefone', cliente_telefone)
            .maybeSingle();

        if (clienteExistente) {
            cliente_id = clienteExistente.id;
        } else {
            const { data: novoC, error: errC } = await supabase
                .from('clientes')
                .insert([{ nome: cliente_nome, telefone: cliente_telefone }])
                .select().single();
            if (errC) throw errC;
            cliente_id = novoC.id;
        }

        // 2. BUSCAR DURAÇÃO REAL
        const { data: servico } = await supabase
            .from('servicos')
            .select('duracao_min')
            .eq('id', servico_id)
            .single();

        const hora_fim = calcularHoraFim(horario_inicio, servico.duracao_min);

        // 3. TRAVA DE OVERBOOKING
        const { data: ocupado } = await supabase
            .from('agendamentos')
            .select('id')
            .eq('data', data)
            .eq('hora_inicio', `${horario_inicio}:00`)
            .eq('profissional_id', funcionario_id)
            .neq('status', 'cancelado');

        if (ocupado && ocupado.length > 0) {
            return res.status(400).json({ success: false, message: "Horário já ocupado." });
        }

        // 4. INSERT COM COLUNA 'origem'
        const { error: errI } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_id, cliente_nome, cliente_telefone, data, 
                hora_inicio: `${horario_inicio}:00`, 
                hora_fim, 
                servico_id, 
                profissional_id: funcionario_id,
                status: 'agendado',
                origem: 'Nati IA' // <-- Identificador para o frontend
            }]);

        if (errI) throw errI;

        res.status(200).json({ 
            success: true, 
            message: `Agendamento realizado pela Nati!`,
            professional: funcionario_id === '3a5b126a-d9d1-4195-8ce2-353feffb0a72' ? 'Nane' : 'Tati'
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Cronosflow v1.5 Online`));
