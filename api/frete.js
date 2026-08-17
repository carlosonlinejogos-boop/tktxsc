// api/frete.js — proxy pro Melhor Envio (cotação de frete)
// Token guardado em variável de ambiente MELHORENVIO_TOKEN no Vercel

// ⚖️ PESO — TEM QUE SER IDÊNTICO ao da edge function `melhorenvio` (que gera a ETIQUETA).
// Lá está escrito "se mudar aqui, mude também em /api/frete" — e nunca foi feito:
// este arquivo usava 0,200 kg por pomada contra 0,016 kg da etiqueta, 12,5x de diferença.
// Resultado: a cotação mostrada ao cliente não tinha relação com o custo real do envio.
//
// Os números abaixo são MEDIDOS, não estimados (conferência dos Correios em 28/07/2026,
// dois pedidos de 50 unidades):
//   Josevanio  50 pomadas          → 0,90 kg
//   Thiago     50 pomadas + 1 Balm → 1,05 kg   (a diferença é exatamente 1 Balm = 0,150 kg)
//   0,90 = 50 × 0,016 + 0,10 de caixa
// Dimensões 12×4×17 foram conferidas e aprovadas pelos Correios.
//
// ⚠️ O GEL (15 ml) ainda NÃO foi pesado numa postagem real — 0,030 kg é estimativa do
// frasco + caixinha. Conferir na primeira etiqueta de gel e corrigir NOS DOIS ARQUIVOS.
const PESO_POR_UNIDADE = 0.016;   // pomada (vale pros 4 modelos)
const PESO_BALM        = 0.15;    // Aftercare Balm 100 g
const PESO_GEL         = 0.030;   // Gel Anestésico 15 ml  ⚠️ estimado
const PESO_EMBALAGEM   = 0.10;    // caixa + plástico
const CAIXA = { height: 4, width: 12, length: 17 };

function pesoDoPedido(un, balm, gel) {
  const p = un * PESO_POR_UNIDADE + balm * PESO_BALM + gel * PESO_GEL + PESO_EMBALAGEM;
  return Math.max(0.3, Number(p.toFixed(3)));
}

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
    const { cep_destino, unidades, balm, gel, valor } = req.body || {};
    if (!cep_destino) return res.status(400).json({ error: 'Faltou cep_destino' });

    const qPomada = Math.max(0, Number(unidades) || 0);
    const qBalm   = Math.max(0, Number(balm)     || 0);
    const qGel    = Math.max(0, Number(gel)      || 0);

    // Antes exigia `unidades`, então pedido SÓ de balm mandava 0 e levava 400 — o site
    // desistia e usava frete estimado. Agora vale qualquer item.
    if (qPomada + qBalm + qGel <= 0) {
      return res.status(400).json({ error: 'Pedido sem itens para cotar' });
    }

    const cep = String(cep_destino).replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });

    // Uma caixa só, igual à etiqueta — cotar por `products` faria o Melhor Envio
    // reempacotar por conta dele e devolver um preço que a etiqueta não repete.
    const body = {
      from: { postal_code: '88332490' },
      to:   { postal_code: cep },
      volumes: [{ ...CAIXA, weight: pesoDoPedido(qPomada, qBalm, qGel) }],
      options: { insurance_value: Number(valor) || 0, receipt: false, own_hand: false },
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
