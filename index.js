const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json());

// Função para calcular a hora de término
const calcularHoraFim = (horaInicio, duracaoMin) => {
    const [h, m] = horaInicio.split(':').map(Number);
    const totalMinutos = h * 60 + m + parseInt(duracaoMin);
    const horasFim = Math.floor(totalMinutos / 60);
    const minutosFim = totalMinutos % 60;
    return `${horasFim.toString().padStart(2, '0')}:${minutosFim.toString().padStart(2, '0')}:00`;
};

// ROTA DE CONSULTA
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

// ROTA DE AGENDAMENTO COM CRM AUTOMÁTICO
app.post('/api/ia/agendar', async (req, res) => {
    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id } = req.body;

    try {
        // 1. BUSCAR OU CRIAR CLIENTE (CRM)
        let cliente_id;
        const { data: clienteExistente, error: erroBusca } = await supabase
            .from('clientes')
            .select('id')
            .eq('telefone', cliente_telefone)
            .maybeSingle();

        if (clienteExistente) {
            cliente_id = clienteExistente.id;
        } else {
            const { data: novoCliente, error: erroCriacao } = await supabase
                .from('clientes')
                .insert([{ nome: cliente_nome, telefone: cliente_telefone }])
                .select()
                .single();
            if (erroCriacao) throw erroCriacao;
            cliente_id = novoCliente.id;
        }

        // 2. BUSCAR DURAÇÃO DO SERVIÇO
        const { data: servico, error: erroServico } = await supabase
            .from('servicos')
            .select('duracao_min')
            .eq('id', servico_id)
            .single();
        if (erroServico) throw new Error("Serviço não encontrado.");

        const hora_fim = calcularHoraFim(horario_inicio, servico.duracao_min);

        // 3. TRAVA DE SEGURANÇA (OVERBOOKING)
        const { data: existe, error: erroCheck } = await supabase
            .from('agendamentos')
            .select('id')
            .eq('data', data)
            .eq('hora_inicio', `${horario_inicio}:00`)
            .eq('profissional_id', funcionario_id)
            .neq('status', 'cancelado');

        if (existe && existe.length > 0) {
            return res.status(400).json({ success: false, message: "Horário ocupado." });
        }

        // 4. INSERIR AGENDAMENTO VINCULADO AO CLIENTE_ID
        const { error: erroInsert } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_id, 
                cliente_nome, 
                cliente_telefone, 
                data, 
                hora_inicio: `${horario_inicio}:00`, 
                hora_fim, 
                servico_id, 
                profissional_id: funcionario_id,
                status: 'agendado'
            }]);

        if (erroInsert) throw erroInsert;
        res.status(200).json({ success: true, message: "Cliente identificado e agendamento realizado!" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Motor Cronosflow v1.2 (CRM) Online`));
