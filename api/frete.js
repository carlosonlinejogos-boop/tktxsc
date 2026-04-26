
// api/frete.js — proxy pro Melhor Envio (cotação de frete)
// Token guardado em variável de ambiente MELHORENVIO_TOKEN no Vercel

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const TOKEN = process.env.MELHORENVIO_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'Token Melhor Envio não configurado' });

  try {
    const { cep_destino, unidades } = req.body || {};
    if (!cep_destino || !unidades) {
      return res.status(400).json({ error: 'Faltou cep_destino ou unidades' });
    }

    const cep = String(cep_destino).replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });

    const un = Number(unidades);

    // Peso real medido: 50 un = 0,50 kg → 10g (0.01 kg) por pomada
    const peso = un * 0.01;

    // Seguro: R$ 15 por pomada
    const insuranceValue = un * 15;

    // Caixa padrão fixa 2×12×17 cm
    const body = {
      from: { postal_code: '88332490' },
      to: { postal_code: cep },
      package: {
        width: 12,
        height: 2,
        length: 17,
        weight: peso
      },
      options: {
        insurance_value: insuranceValue,
        receipt: false,
        own_hand: false
      }
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

    // Filtra só Correios PAC, Correios SEDEX e J&T Express
    const servicos = data
      .filter(s => {
        if (s.error || !s.price) return false;
        const empresa = (s.company?.name || '').toLowerCase();
        const nome = (s.name || '').toLowerCase();
        if (empresa.includes('correios') && nome === 'pac') return true;
        if (empresa.includes('correios') && nome === 'sedex') return true;
        if (empresa.includes('j&t') || empresa.includes('jt express')) return true;
        return false;
      })
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
