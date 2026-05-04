// api/frete.js — proxy pro Melhor Envio (cotação de frete)
// Token guardado em variável de ambiente MELHORENVIO_TOKEN no Vercel
//
// Versão 2 — com logs detalhados e fallback de transportadoras
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
      console.error('[FRETE] Erro Melhor Envio HTTP:', r.status, txt);
      return res.status(r.status).json({ error: 'Erro Melhor Envio', detail: txt, status: r.status });
    }
    
    const data = await r.json();
    if (!Array.isArray(data)) {
      console.error('[FRETE] Resposta não é array:', data);
      return res.status(200).json({ servicos: [] });
    }
    
    // LOG DETALHADO — pra debug no Vercel: vê quais serviços vieram e quais falharam
    console.log('[FRETE] CEP:', cep, '| Unidades:', un, '| Peso:', peso, 'kg');
    console.log('[FRETE] Total de serviços retornados:', data.length);
    data.forEach(s => {
      const empresa = s.company?.name || 'sem-empresa';
      const nome = s.name || 'sem-nome';
      if (s.error) {
        console.log(`[FRETE] ❌ ${empresa} ${nome} — ERRO: ${s.error}`);
      } else if (!s.price) {
        console.log(`[FRETE] ⚠️ ${empresa} ${nome} — sem preço`);
      } else {
        console.log(`[FRETE] ✓ ${empresa} ${nome} — R$ ${s.price} | ${s.delivery_time}d`);
      }
    });
    
    // Filtro principal: PAC, SEDEX, J&T Express (preferenciais)
    const servicosPrincipais = data
      .filter(s => {
        if (s.error || !s.price) return false;
        // Normaliza: minúscula + remove "&amp;" + remove espaços extras
        const empresa = (s.company?.name || '')
          .toLowerCase()
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
        const nome = (s.name || '')
          .toLowerCase()
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
        // Aceita Correios PAC e SEDEX
        if (empresa.includes('correios') && nome === 'pac') return true;
        if (empresa.includes('correios') && nome === 'sedex') return true;
        // Aceita J&T (várias variações: "j&t", "jt", "j t", "jet")
        // Detecta por: nome da empresa ou ID padrão da J&T no Melhor Envio (ID 12 = J&T Express)
        if (empresa.includes('j&t') || empresa.includes('jt express') || 
            empresa.includes('jet express') || empresa === 'jt' || 
            empresa.startsWith('j&t') || empresa.startsWith('jt ')) return true;
        if (s.company?.id === 12) return true; // ID oficial da J&T no Melhor Envio
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
    
    // FALLBACK: se PAC/SEDEX/J&T TODOS falharam, aceita outras transportadoras
    // (Jadlog, Loggi, Total Express, Azul Cargo, etc) pra cliente não ficar sem frete
    let servicos = servicosPrincipais;
    if (servicos.length === 0) {
      console.warn('[FRETE] Nenhum serviço principal disponível — usando fallback');
      servicos = data
        .filter(s => !s.error && s.price)
        .map(s => ({
          id: s.id,
          nome: s.name,
          empresa: s.company?.name || '',
          preco: parseFloat(s.custom_price || s.price),
          prazo: s.custom_delivery_time || s.delivery_time
        }))
        .sort((a, b) => a.preco - b.preco)
        .slice(0, 3); // Máximo 3 alternativas
    }
    
    if (servicos.length === 0) {
      console.error('[FRETE] NENHUM serviço disponível pro CEP', cep);
    }
    
    return res.status(200).json({ servicos });
  } catch (e) {
    console.error('[FRETE] Erro interno:', e);
    return res.status(500).json({ error: 'Erro interno', detail: String(e) });
  }
}
