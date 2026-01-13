const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();

// Conexão Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());

/**
 * MIDDLEWARE DE LIMPEZA ROBUSTA (Anti-Erro de Sintaxe IA)
 * Captura o texto bruto e tenta extrair um JSON válido mesmo se a IA enviar lixo ou aspas extras.
 */
app.use(express.text({ type: 'application/json' })); 

app.use((req, res, next) => {
    if (typeof req.body === 'string' && req.body.trim().length > 0) {
        let corpo = req.body.trim();
        
        // 1. Remove aspas externas triplas ou duplas que envolvem o objeto
        corpo = corpo.replace(/^["']+|["']+$/g, '');

        try {
            // 2. Tenta tratar caracteres de escape comuns e faz o parse
            const tratada = corpo.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            req.body = JSON.parse(tratada);
        } catch (e) {
            // 3. FALLBACK: Se falhar, tenta "caçar" apenas o que está entre as chaves { }
            try {
                const match = corpo.match(/\{[\s\S]*\}/);
                if (match) {
                    req.body = JSON.parse(match[0]);
                }
            } catch (err2) {
                console.error("❌ Falha crítica ao parsear JSON da IA. Recebido:", corpo);
                req.body = {}; // Evita que o servidor trave
            }
        }
    }
    next();
});

app.use(express.json());

// CONFIGURAÇÃO: ID da Zona de Espera como padrão
const ID_ZONA_ESPERA = 'f7ed71fa-4c8c-47f9-8ed6-7e92327f3f82';

// ------------------------------------------------------------------
// ROTA: CONSULTAR DISPONIBILIDADE
// ------------------------------------------------------------------
app.all('/api/ia/consultar', async (req, res) => {
    // Aceita dados tanto do Body (POST) quanto da URL (GET)
    const dados = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    
    // Tratamento de campos: Data e Profissional Padrão
    const data = dados.data || dados.date;
    const funcionario_id = dados.funcionario_id || dados.profissional_id || ID_ZONA_ESPERA;

    if (!data) {
        return res.status(400).json({ error: "Campo 'data' não identificado." });
    }

    try {
        const { data: horarios, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') 
            .eq('data', data)
            .eq('profissional_id', funcionario_id)
            .neq('status', 'cancelado');

        if (error) throw error;

        // Lista de horários permitidos na clínica
        const todosHorarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const ocupados = horarios.map(h => h.hora_inicio.substring(0, 5));
        const disponiveis = todosHorarios.filter(h => !ocupados.includes(h));

        // Retorna um objeto limpo para a IA
        res.status(200).json({ disponiveis, ocupados });
    } catch (error) {
        console.error("Erro na consulta:", error.message);
        res.status(500).json({ error: "Erro interno ao acessar agenda." });
    }
});

// ------------------------------------------------------------------
// ROTA: REALIZAR AGENDAMENTO
// ------------------------------------------------------------------
app.all('/api/ia/agendar', async (req, res) => {
    const dados = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    
    const { cliente_nome, data, horario_inicio, servico_id } = dados;
    const funcionario_id = dados.funcionario_id || ID_ZONA_ESPERA;

    if (!cliente_nome || !data || !horario_inicio) {
        return res.status(400).json({ error: "Dados insuficientes (nome, data ou hora ausentes)." });
    }

    try {
        // Cálculo automático de hora_fim (Duração padrão 1h)
        let [hora, minuto] = horario_inicio.split(':');
        let hora_fim = `${(parseInt(hora) + 1).toString().padStart(2, '0')}:${minuto}:00`;

        const { error } = await supabase
            .from('agendamentos')
            .insert([{ 
                cliente_nome, 
                data, 
                hora_inicio: horario_inicio.includes(':') && horario_inicio.length === 5 ? `${horario_inicio}:00` : horario_inicio, 
                hora_fim: hora_fim,
                servico_id: servico_id || null, 
                profissional_id: funcionario_id,
                status: 'agendado',
                origem: 'Nati IA'
            }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Agendamento salvo na Zona de Espera!' });
    } catch (error) {
        console.error("Erro no agendamento:", error.message);
        res.status(500).json({ error: "Erro ao gravar agendamento." });
    }
});

app.get('/', (req, res) => res.send('🚀 Cronosflow Backend Robust V2.1 Online!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
