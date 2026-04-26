
// api/frete.js — proxy pro Melhor Envio (cotação de frete)
// Token guardado em variável de ambiente MELHORENVIO_TOKEN no Vercel

export default async function handler(req, res) {
  // CORS básico (pra debug)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const TOKEN = process.env.MELHORENVIO_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'Token Melhor Envio não configurado' });

  try {
    const { cep_destino, unidades, valor } = req.body || {};
    if (!cep_destino || !unidades) {
      return res.status(400).json({ error: 'Faltou cep_destino ou unidades' });
    }

    const cep = String(cep_destino).replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });

    // Peso: 0.2kg por pomada
    // Dimensões da pomada: 2x12x17 cm
    // O Melhor Envio cuida do empacotamento se passar dos limites
    const peso = Number(unidades) * 0.2;

    const body = {
      from: { postal_code: '88332490' },
      to: { postal_code: cep },
      products: [{
        id: 'tktx-pomada',
        width: 12,
        height: 2,
        length: 17,
        weight: peso,
        insurance_value: Number(valor) || 0,
        quantity: Number(unidades)
      }]
    };

    const r = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent': 'TKTX SC Assistente Pro (tktxscoficial@gmail.com)'
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: 'Erro Melhor Envio', detail: txt });
    }

    const data = await r.json();
    if (!Array.isArray(data)) return res.status(200).json({ servicos: [] });

    // Filtrar só PAC, SEDEX e Jet Express, e tirar erros
    const permitidos = ['PAC', 'SEDEX', 'Jet'];
    const servicos = data
      .filter(s => !s.error && s.price && permitidos.some(p => (s.name || '').toUpperCase().includes(p.toUpperCase())))
      .map(s => ({
        id: s.id,
        nome: s.name,
        empresa: s.company?.name || '',
        preco: parseFloat(s.custom_price || s.price),
        prazo: s.custom_delivery_time || s.delivery_time
      }))
      .sort((a, b) => a.preco - b.preco);

    return res.status(200).json({ servicos });
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno', detail: String(e) });
  }
}
