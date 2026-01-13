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

// ===== FUNÇÕES AUXILIARES PARA VALIDAÇÃO =====

// Busca profissionais humanos (exclui Zona de Espera)
async function buscarProfissionaisHumanos() {
    const { data, error } = await supabase
        .from('profissionais')
        .select('id, nome, ativo')
        .neq('nome', 'Zona de Espera')
        .neq('ativo', false)
        .order('nome');
    
    if (error) throw error;
    return data || [];
}

// Busca Zona de Espera
async function buscarZonaEspera() {
    const { data, error } = await supabase
        .from('profissionais')
        .select('id, nome')
        .or('nome.ilike.%Zona de Espera%,nome.ilike.%Espera%')
        .single();
    
    if (error) {
        console.warn('Zona de Espera não encontrada:', error.message);
        return null;
    }
    return data;
}

// Verifica disponibilidade real entre profissionais humanos
async function verificarDisponibilidadeReal(data, horaInicio, servicoId) {
    try {
        // 1. Busca profissionais humanos
        const profissionaisHumanos = await buscarProfissionaisHumanos();
        
        if (profissionaisHumanos.length === 0) {
            throw new Error('Nenhum profissional humano encontrado');
        }
        
        // 2. Busca duração do serviço
        const { data: servico, error: servicoError } = await supabase
            .from('servicos')
            .select('duracao_min')
            .eq('id', servicoId)
            .single();
        
        if (servicoError) throw servicoError;
        
        const duracaoMin = servico.duracao_min || 60;
        
        // 3. Converte horários para minutos
        const [hora, minuto] = horaInicio.split(':').map(Number);
        const inicioMinutos = hora * 60 + minuto;
        const fimMinutos = inicioMinutos + duracaoMin;
        
        // 4. Busca agendamentos do dia para profissionais humanos
        const { data: agendamentos, error: agendaError } = await supabase
            .from('agendamentos')
            .select('profissional_id, hora_inicio, servico_id')
            .eq('data', data)
            .neq('status', 'cancelado')
            .in('profissional_id', profissionaisHumanos.map(p => p.id));
        
        if (agendaError) throw agendaError;
        
        // 5. Verifica sobreposição
        let profissionaisOcupados = new Set();
        
        for (const ag of agendamentos || []) {
            const [agHora, agMin] = ag.hora_inicio.split(':').map(Number);
            const agInicio = agHora * 60 + agMin;
            
            // Busca duração do serviço agendado
            const { data: servicoAg, error: _ } = await supabase
                .from('servicos')
                .select('duracao_min')
                .eq('id', ag.servico_id)
                .single();
            
            const duracaoAg = servicoAg?.duracao_min || 60;
            const agFim = agInicio + duracaoAg;
            
            // Verifica sobreposição
            if (agInicio < fimMinutos && agFim > inicioMinutos) {
                profissionaisOcupados.add(ag.profissional_id);
            }
        }
        
        // 6. Calcula vagas disponíveis
        const vagasDisponiveis = profissionaisHumanos.length - profissionaisOcupados.size;
        const todosOcupados = profissionaisOcupados.size >= profissionaisHumanos.length;
        
        console.log(`📊 Backend Validação: ${data} ${horaInicio} - Humanos: ${profissionaisHumanos.length}, Ocupados: ${profissionaisOcupados.size}, Vagas: ${vagasDisponiveis}, Disponível: ${!todosOcupados}`);
        
        return {
            disponivel: !todosOcupados,
            vagasDisponiveis,
            profissionaisHumanos: profissionaisHumanos.map(p => p.nome),
            profissionaisOcupados: Array.from(profissionaisOcupados),
            todosOcupados
        };
        
    } catch (error) {
        console.error('Erro na validação de disponibilidade:', error);
        throw error;
    }
}

// ===== ENDPOINTS =====

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

// AGENDAMENTO COM VALIDAÇÃO DE DISPONIBILIDADE REAL
app.post('/api/ia/agendar', async (req, res) => {
    const { cliente_nome, cliente_telefone, data, horario_inicio, servico_id, funcionario_id, origem = 'Nati IA' } = req.body;

    try {
        console.log(`📨 IA Tentando agendar: ${cliente_nome} para ${data} ${horario_inicio}`);
        
        // ===== 1. VERIFICA SE É ZONA DE ESPERA =====
        const zonaEspera = await buscarZonaEspera();
        
        if (!zonaEspera) {
            return res.status(400).json({ 
                success: false, 
                message: "Zona de Espera não configurada no sistema" 
            });
        }
        
        // Se a IA está tentando agendar diretamente em humano, REDIRECIONA para Zona de Espera
        let profissionalAlvoId = funcionario_id;
        if (funcionario_id !== zonaEspera.id) {
            console.log(`🔄 IA redirecionando de ${funcionario_id} para Zona de Espera`);
            profissionalAlvoId = zonaEspera.id;
        }
        
        // ===== 2. VALIDA DISPONIBILIDADE REAL (ANTES DE QUALQUER AÇÃO) =====
        const validacao = await verificarDisponibilidadeReal(data, horario_inicio, servico_id);
        
        if (!validacao.disponivel) {
            return res.status(400).json({ 
                success: false, 
                message: `Horário indisponível - Todas as profissionais (${validacao.profissionaisHumanos.join(', ')}) estão ocupadas`,
                detalhes: {
                    profissionaisHumanos: validacao.profissionaisHumanos,
                    vagasDisponiveis: validacao.vagasDisponiveis,
                    todosOcupados: validacao.todosOcupados,
                    horario: `${data} ${horario_inicio}`
                },
                codigo: 'CLINICA_LOTADA'
            });
        }
        
        console.log(`✅ Disponível! Vagas: ${validacao.vagasDisponiveis}/${validacao.profissionaisHumanos.length}`);
        
        // ===== 3. CRM: BUSCAR OU CRIAR CLIENTE =====
        let cliente_id;
        if (cliente_telefone) {
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
                    .select()
                    .single();
                if (errC) throw errC;
                cliente_id = novoC.id;
            }
        } else {
            // Cliente sem telefone (pode acontecer)
            const { data: novoC, error: errC } = await supabase
                .from('clientes')
                .insert([{ nome: cliente_nome }])
                .select()
                .single();
            if (errC) throw errC;
            cliente_id = novoC.id;
        }
        
        // ===== 4. BUSCAR DURAÇÃO REAL =====
        const { data: servico, error: servicoError } = await supabase
            .from('servicos')
            .select('duracao_min, nome')
            .eq('id', servico_id)
            .single();
        
        if (servicoError) throw servicoError;
        
        const hora_fim = calcularHoraFim(horario_inicio, servico.duracao_min);
        
        // ===== 5. TRAVA DE OVERBOOKING NA ZONA DE ESPERA =====
        const { data: ocupado } = await supabase
            .from('agendamentos')
            .select('id')
            .eq('data', data)
            .eq('hora_inicio', `${horario_inicio}:00`)
            .eq('profissional_id', profissionalAlvoId)
            .neq('status', 'cancelado');
        
        if (ocupado && ocupado.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Este slot na Zona de Espera já está ocupado." 
            });
        }
        
        // ===== 6. INSERT NA ZONA DE ESPERA COM ORIGEM IA =====
        const { data: novoAgendamento, error: errI } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_id, 
                cliente_nome, 
                cliente_telefone, 
                data, 
                hora_inicio: `${horario_inicio}:00`, 
                hora_fim, 
                servico_id, 
                profissional_id: profissionalAlvoId,
                status: 'agendado',
                origem: origem,
                notas: `Criado pela Nati IA - Disponível para: ${validacao.profissionaisHumanos.join(', ')}`
            }])
            .select()
            .single();
        
        if (errI) throw errI;
        
        // ===== 7. RESPOSTA COM DETALHES =====
        res.status(200).json({ 
            success: true, 
            message: `Agendamento criado na Zona de Espera com sucesso!`,
            detalhes: {
                id: novoAgendamento.id,
                cliente: cliente_nome,
                data: data,
                horario: horario_inicio,
                servico: servico.nome,
                profissional: 'Zona de Espera',
                vagasDisponiveis: validacao.vagasDisponiveis,
                profissionaisDisponiveis: validacao.profissionaisHumanos,
                observacao: 'Aguardando redistribuição para profissional humano'
            }
        });
        
        console.log(`🎯 IA Agendou: ${cliente_nome} na Zona de Espera (ID: ${novoAgendamento.id})`);

    } catch (error) {
        console.error('❌ Erro no agendamento IA:', error);
        res.status(500).json({ 
            success: false, 
            message: "Erro interno no agendamento",
            erro: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ===== NOVO ENDPOINT: VERIFICAR DISPONIBILIDADE =====
app.post('/api/ia/verificar-disponibilidade', async (req, res) => {
    const { data, horario_inicio, servico_id } = req.body;
    
    try {
        const validacao = await verificarDisponibilidadeReal(data, horario_inicio, servico_id);
        
        res.status(200).json({
            success: true,
            disponivel: validacao.disponivel,
            vagasDisponiveis: validacao.vagasDisponiveis,
            profissionaisHumanos: validacao.profissionaisHumanos,
            profissionaisOcupados: validacao.profissionaisOcupados,
            todosOcupados: validacao.todosOcupados,
            mensagem: validacao.disponivel 
                ? `Há ${validacao.vagasDisponiveis} vaga(s) disponível(is) entre ${validacao.profissionaisHumanos.join(', ')}`
                : `Horário indisponível - Todas as profissionais (${validacao.profissionaisHumanos.join(', ')}) ocupadas`
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Erro ao verificar disponibilidade",
            error: error.message 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Cronosflow IA v2.0 Online - Com validação de disponibilidade real`));
