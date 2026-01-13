const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.text({ type: 'application/json' }));

const ID_ZONA_ESPERA = 'f7ed71fa-4c8c-47f9-8ed6-7e92327f3f82';

/**
 * MOTOR DE TRADUÇÃO DE DATAS NATURAIS (V5.1)
 * Converte termos como "amanhã", "sábado" ou "14/01" em datas válidas
 */
function normalizarData(texto) {
    const hoje = new Date();
    // Limpeza de caracteres que a IA envia por erro
    const textoLimpo = String(texto).toLowerCase().replace(/[{}""\s]/g, '');
    
    if (textoLimpo.includes('hoje')) return hoje.toISOString().split('T')[0];
    if (textoLimpo.includes('amanhã') || textoLimpo.includes('amanha')) {
        const amanha = new Date();
        amanha.setDate(hoje.getDate() + 1);
        return amanha.toISOString().split('T')[0];
    }

    const diasSemana = {
        'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 'quinta': 4,
        'sexta': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
    };

    for (let dia in diasSemana) {
        if (textoLimpo.includes(dia)) {
            const target = diasSemana[dia];
            const hojeDia = hoje.getDay();
            let diff = target - hojeDia;
            if (diff <= 0) diff += 7; // Garante que seja a próxima ocorrência do dia
            const dataAlvo = new Date();
            dataAlvo.setDate(hoje.getDate() + diff);
            return dataAlvo.toISOString().split('T')[0];
        }
    }

    const matchBR = textoLimpo.match(/(\d{2})\/(\d{2})(\/\d{4,5})?/);
    if (matchBR) {
        const dia = matchBR[1];
        const mes = matchBR[2];
        let ano = matchBR[3] ? matchBR[3].replace('/', '') : hoje.getFullYear();
        // Correção de erro de digitação comum da IA
        if (ano.toString().includes('20206')) ano = '2026';
        return `${ano}-${mes}-${dia}`;
    }

    const matchISO = textoLimpo.match(/(\d{4}-\d{2}-\d{2})/);
    return matchISO ? matchISO[0] : null;
}

function extrairDados(corpoBruto) {
    const texto = String(corpoBruto);
    
    // Captura o campo de data ou tenta normalizar o texto todo
    const dataMatch = texto.match(/data["']?\s*:\s*["']?([^"'}]+)/) || texto.match(/date["']?\s*:\s*["']?([^"'}]+)/);
    const data = dataMatch ? normalizarData(dataMatch[1]) : normalizarData(texto);

    let hora = "09:00";
    const matchHora = texto.match(/(\d{2}:\d{2})/);
    if (matchHora) hora = matchHora[0];

    let nome = "Cliente Whats";
    const matchNome = texto.match(/cliente_nome["']?\s*:\s*["']?([^"'}]+)/);
    if (matchNome) nome = matchNome[1].trim();

    // Extrai o UUID do serviço se disponível
    let ids = texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    const servico_id = ids && ids.length > 0 ? ids[0] : null;

    return { data, hora, nome, servico_id };
}

// ROTA: CONSULTAR DISPONIBILIDADE
app.all('/api/ia/consultar', async (req, res) => {
    const { data } = extrairDados(req.body);
    if (!data) return res.status(400).json({ error: "Data não reconhecida." });

    try {
        const { data: ocupados, error } = await supabase
            .from('agendamentos')
            .select('hora_inicio') 
            .eq('data', data)
            .neq('status', 'cancelado'); // Considera ocupado em qualquer coluna para a IA

        if (error) throw error;
        const todos = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
        const listaOcupados = ocupados.map(h => h.hora_inicio.substring(0, 5));
        res.status(200).json({ disponiveis: todos.filter(h => !listaOcupados.includes(h)) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ROTA: AGENDAR (DISPARA JUNTO COM O PIX)
app.all('/api/ia/agendar', async (req, res) => {
    const { data, hora, nome, servico_id } = extrairDados(req.body);
    if (!data || !hora) return res.status(400).json({ error: "Dados insuficientes." });

    try {
        const [h, m] = hora.split(':');
        const horaFim = `${(parseInt(h) + 1).toString().padStart(2, '0')}:${m}:00`;
        
        const { error } = await supabase.from('agendamentos').insert([{ 
            cliente_nome: nome,
            data,
            hora_inicio: `${hora}:00`,
            hora_fim: horaFim,
            servico_id: servico_id,
            profissional_id: ID_ZONA_ESPERA, // SEMPRE Zona de Espera
            status: 'agendado',
            origem: 'Nati IA'
        }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: "Pré-reserva na Zona de Espera concluída!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => res.send('🚀 Cronosflow V5.1 - Fluxo Pix + Zona de Espera Ativo!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor na porta ${PORT}`));
