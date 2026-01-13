const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.text({ type: 'application/json' })); // Captura como texto puro para não dar erro de sintaxe

const ID_ZONA_ESPERA = 'f7ed71fa-4c8c-47f9-8ed6-7e92327f3f82';

/**
 * FUNÇÃO DE INTELIGÊNCIA ARTIFICIAL CASEIRA
 * Extrai data, hora e IDs de qualquer "lixo" que o WhatsWave enviar
 */
function extrairDados(corpoBruto) {
    const texto = String(corpoBruto);
    
    // 1. Busca Data (DD/MM/AAAA ou AAAA-MM-DD)
    let data = null;
    const matchData = texto.match(/(\d{2}\/\d{2}\/\d{4})|(\d{4}-\d{2}-\d{2})/);
    if (matchData) {
        data = matchData[0].includes('/') 
            ? matchData[0].split('/').reverse().join('-') 
            : matchData[0];
        
        // Correção para o erro de digitação "20206" -> "2026"
        data = data.replace('20206', '2026');
    }

    // 2. Busca Horário (HH:mm)
    let hora = "09:00";
    const matchHora = texto.match(/(\d{2}:\d{2})/);
    if (matchHora) hora = matchHora[0];

    // 3. Busca UUIDs (IDs de Serviço ou Funcionário)
    let ids = texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    
    // O primeiro UUID geralmente é o serviço, o segundo seria o funcionário (que ignoramos)
    const servico_id = ids && ids.length > 0 ? ids[0] : null;

    // 4. Busca Nome do Cliente (Tudo que estiver após "cliente_nome":" até a próxima aspa)
    let nome = "Cliente Whats";
    const matchNome = texto.match(/cliente_nome["']?\s*:\s*["']?([^"'}]+)/);
    if (matchNome) nome = matchNome[1].trim();

    return { data, hora, servico_id, nome };
}

// ROTA CONSULTAR: Agora usa a extração inteligente
app.all('/api/ia/consultar', async (req, res) => {
    console.log("📥 Recebido para consulta:", req.body);
    const { data } = extrairDados(req.body);

    if (!data) return res.status(400).json({ error: "Data não encontrada no envio." });

    try {
        const { data: ocupados, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') 
            .eq('data', data)
            .eq('profissional_id', ID_ZONA_ESPERA)
            .neq('status', 'cancelado');

        if (error) throw error;

        const todos = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
        const listaOcupados = ocupados.map(h => h.hora_inicio.substring(0, 5));
        const disponiveis = todos.filter(h => !listaOcupados.includes(h));

        res.status(200).json({ disponiveis });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROTA AGENDAR: Agora usa a extração inteligente
app.all('/api/ia/agendar', async (req, res) => {
    console.log("📥 Recebido para agendar:", req.body);
    const { data, hora, servico_id, nome } = extrairDados(req.body);

    if (!data || !hora) return res.status(400).json({ error: "Data ou hora faltando." });

    try {
        const horaFim = `${(parseInt(hora.split(':')[0]) + 1).toString().padStart(2, '0')}:${hora.split(':')[1]}:00`;

        const { error } = await supabase.from('agendamentos').insert([{ 
            cliente_nome: nome,
            data,
            hora_inicio: `${hora}:00`,
            hora_fim: horaFim,
            servico_id,
            profissional_id: ID_ZONA_ESPERA,
            status: 'agendado',
            origem: 'Nati IA'
        }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'Agendado na Zona de Espera!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => res.send('🚀 Cronosflow Backend ULTRA ROBUSTO V4 Online!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
