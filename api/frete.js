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
    const { cep_destino, unidades, balm } = req.body || {};
    if (!cep_destino || (!unidades && !balm)) {
      return res.status(400).json({ error: 'Faltou cep_destino ou unidades' });
    }
    const cep = String(cep_destino).replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });
    const un = Number(unidades) || 0;
    const nBalm = Number(balm) || 0;

    // 🚫 ESTADOS ONDE A J&T NÃO SERVE (31/07/2026 — caso Wilson, CE)
    // O que aconteceu: a J&T COTOU R$ 39,87 pro Ceará, o cliente pagou, e na hora de
    // gerar a etiqueta a J&T recusou (não aceita declaração de conteúdo naquele estado).
    // Teve que refazer por Correios PAC a R$ 85 → R$ 45 de prejuízo NO PEDIDO.
    // Regra: nos estados desta lista a J&T nem aparece pro cliente — só Correios.
    // Conferido no histórico de 120 dias: a J&T entregou 100% em SP, PR, RJ, BA, RS, SC,
    // MG, DF, MT, TO, RN, AL, ES, GO, MS. O ÚNICO estado que falhou foi o CE.
    // ➕ Pra bloquear outro estado depois: é só acrescentar a sigla nesta lista.
    const JT_BLOQUEADA_UF = ['CE'];

    function ufDoCep(c) {
      const n = parseInt(String(c).substring(0, 5), 10);
      if (!isFinite(n)) return null;
      if (n <= 19999) return 'SP';
      if (n <= 28999) return 'RJ';
      if (n <= 29999) return 'ES';
      if (n <= 39999) return 'MG';
      if (n <= 48999) return 'BA';
      if (n <= 49999) return 'SE';
      if (n <= 56999) return 'PE';
      if (n <= 57999) return 'AL';
      if (n <= 58999) return 'PB';
      if (n <= 59999) return 'RN';
      if (n <= 63999) return 'CE';
      if (n <= 64999) return 'PI';
      if (n <= 65999) return 'MA';
      if (n <= 68899) return 'PA';
      if (n <= 68999) return 'AP';
      if (n <= 69299) return 'AM';
      if (n <= 69399) return 'RR';
      if (n <= 69899) return 'AM';
      if (n <= 69999) return 'AC';
      if (n <= 73699) return 'DF';
      if (n <= 76799) return 'GO';
      if (n <= 76999) return 'RO';
      if (n <= 77999) return 'TO';
      if (n <= 78899) return 'MT';
      if (n <= 79999) return 'MS';
      if (n <= 87999) return 'PR';
      if (n <= 89999) return 'SC';
      return 'RS';
    }
    const ufDestino = ufDoCep(cep);
    const jtBloqueada = JT_BLOQUEADA_UF.indexOf(ufDestino) >= 0;
    if (jtBloqueada) console.log('[FRETE] 🚫 J&T bloqueada para', ufDestino, '— só Correios neste CEP');
    
    // ⚖️ PESO — TEM QUE SER IGUAL AO DA ETIQUETA (edge function "melhorenvio" do Supabase).
    // PESO REAL (conferência dos Correios em 28/07/2026, 2 pedidos de 50 un):
    //   Thiago: declaramos 0,5 kg → Correios pesaram 1,05 kg → cobraram +R$ 17,09
    //   Josevanio: declaramos 0,5 kg → Correios pesaram 0,90 kg → cobraram +R$ 1,52
    // 28/07 — os dois pedidos eram 50 TKTX; SÓ o do Thiago levava 1 Balm junto:
    //   Josevanio  50 TKTX          = 0,90 kg  →  50 x 16 g + 100 g de caixa
    //   Thiago     50 TKTX + 1 Balm = 1,05 kg  →  a diferença (150 g) É O BALM
    // Logo: 16 g por pomada · 150 g por balm · 100 g de caixa. Mínimo 300 g.
    // ⚠️ BUG CORRIGIDO 27/07/2026: aqui era 0.01 e a ETIQUETA usava 0.06 (60 g/un).
    // Um pedido de 50 un era cotado como 0,5 kg (cliente pagava R$ 72,42) mas a etiqueta
    // saía com 3 kg (custava R$ 96,70) = R$ 24,28 de prejuízo POR PEDIDO.
    // SE MUDAR AQUI, MUDE TAMBÉM na edge function melhorenvio (const PESO_POR_UNIDADE).
    const PESO_POR_UNIDADE = 0.016;  // 16 g por pomada
    const PESO_BALM       = 0.15;    // 150 g o Aftercare Balm
    const PESO_EMBALAGEM  = 0.10;    // caixa + plástico
    const peso = Math.max(0.3, Number((un * PESO_POR_UNIDADE + nBalm * PESO_BALM + PESO_EMBALAGEM).toFixed(3)));
    // Seguro: R$ 15 por pomada + R$ 30 por balm
    const insuranceValue = un * 15 + nBalm * 30;

    // Caixa padrão 12×4×17 cm — a MESMA declarada na etiqueta (antes a cotação usava 2 cm de altura)
    const body = {
      from: { postal_code: '88332490' },
      to: { postal_code: cep },
      package: {
        width: 12,
        height: 4,
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
    console.log('[FRETE] CEP:', cep, '| Unidades:', un, '| Balm:', nBalm, '| Peso:', peso, 'kg');
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
        const ehJT = (empresa.includes('j&t') || empresa.includes('jt express') ||
            empresa.includes('jet express') || empresa === 'jt' || empresa.includes('jet') ||
            empresa.startsWith('j&t') || empresa.startsWith('jt ') || s.company?.id === 12);
        // 🚫 nos estados da lista a J&T não gera etiqueta → nem oferece pro cliente
        if (ehJT) return !jtBloqueada;
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
    
    // SÓ usa as 3 transportadoras autorizadas: Correios PAC, Correios SEDEX e J&T Express
    // Se nenhuma das 3 estiver disponível, o front mostra opção manual via WhatsApp
    const servicos = servicosPrincipais;
    
    if (servicos.length === 0) {
      console.error('[FRETE] NENHUMA das 3 transportadoras (PAC/SEDEX/J&T) disponível pro CEP', cep);
    }
    
    return res.status(200).json({ servicos });
  } catch (e) {
    console.error('[FRETE] Erro interno:', e);
    return res.status(500).json({ error: 'Erro interno', detail: String(e) });
  }
}
