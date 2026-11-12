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
//
// ⚠️ O SPRAY TKTX (30 ml, 13/09/2026) também NÃO foi pesado — 0,060 kg é estimativa. Conferir na
// primeira etiqueta de spray e corrigir NOS DOIS ARQUIVOS (aqui e na edge melhorenvio).
const PESO_POR_UNIDADE = 0.016;   // pomada (vale pros 4 modelos)
const PESO_BALM        = 0.15;    // Aftercare Balm 100 g
const PESO_GEL         = 0.030;   // Gel Anestésico 15 ml  ⚠️ estimado
const PESO_SPRAY       = 0.060;   // Spray TKTX 30 ml      ⚠️ estimado
const PESO_EMBALAGEM   = 0.10;    // caixa + plástico
const CAIXA = { height: 4, width: 12, length: 17 };

function pesoDoPedido(un, balm, gel, spray = 0) {
  const p = un * PESO_POR_UNIDADE + balm * PESO_BALM + gel * PESO_GEL + spray * PESO_SPRAY + PESO_EMBALAGEM;
  return Math.max(0.3, Number(p.toFixed(3)));
}

// ══════════════════════════════════════════════════════════════════════════════
// 🚚 QUEM APARECE PRO CLIENTE
//
// 🐛 O BUG QUE MATOU A J&T SEM NINGUÉM PERCEBER (17/08 → 25/08/2026).
//    A versão anterior filtrava assim:
//        const permitidos = ['PAC','SEDEX','Jet'];
//        data.filter(s => permitidos.some(p => (s.name||'').includes(p)))
//    ...comparando com o NOME DO SERVIÇO. No Melhor Envio a J&T vem como
//    company.name = "JeT" e name = "Standard" — e "Standard" não contém "Jet".
//    A J&T sumiu do site no dia 17/08 (último pedido dela) e ninguém mais pôde
//    escolher: 82 pedidos seguidos só de Correios. De quebra, ".Package" da Jadlog
//    CONTÉM "pac" e passava sem nunca ter sido autorizada.
//    Regra nova: casar por EMPRESA; o nome do serviço só refina Correios e Loggi.
//
// 🛵 25/08 — o Carlos pausou a J&T de manhã ("tive muito problema") e RELIGOU à tarde:
//    "adicione a JeT também e deixe os 4 fretes de preferência para os clientes, deixe o
//    aviso da JeT e Loggi sobre as 3 tentativas". Então ficam 4 opções — PAC, SEDEX, J&T e
//    Loggi Express — e o aviso das 3 tentativas aparece nas duas privadas (freteAvisoServico
//    do index.html). Quem decide é o cliente, sabendo o que cada uma faz se ninguém receber.
//    Medição de 25/08 (12 capitais, 0,3 kg, origem 88332490):
//      · Loggi Express  cota em 12/12 · SP R$18,68/3d · RJ R$15,38/4d · GO R$16,63/5d
//        ⚠️ cara em Salvador (R$54,56) e Manaus (R$38,93) — nesses casos ela só
//        aparece por último na lista e o cliente escolhe Correios; ninguém é forçado.
//      · Loggi Coleta   0/12 — "trecho temporariamente indisponível". Fora.
//      · Loggi Ponto    12/12 mas 7 a 15 dias e às vezes mais cara. Fora.
//
// ⚠️ Esta lista TEM que contar a mesma história que filtrarServicosFrete() do index.html.
// ⚠️ E o serviceId() da edge `melhorenvio` precisa saber mapear tudo que sair daqui,
//    senão a etiqueta sai pela transportadora errada (era o caso da Loggi até a v22).
// ══════════════════════════════════════════════════════════════════════════════
// 🚚 03/11/2026 — J&T e Loggi FORA (41 volumes parados no ponto Pegaki desde 29/10). Ficam Mini Envios, PAC e SEDEX.
// 🚚 05/11/2026 — LOGGI DE VOLTA + NO MÁXIMO 3 FRETES (escolherFretes, abaixo). A TKTX: "Loggi no momento é o melhor custo
//    benefício, até para SP"; "acho muito feio uma quantidade exorbitante de frete aparecendo".
//    Interruptor SEM subir arquivo: site_config.frete_loggi = 'off' desliga a Loggi em até 1 minuto ('on' liga).
//    Se o banco não responder, vale a constante abaixo. J&T segue pausada: na cotação das 27 capitais (05/11) ela foi
//    mais cara que a Loggi em TODAS e mais cara que os Correios no Nordeste — não ganha em lugar nenhum.
const JT_PAUSADA = true;     // 25/08 — pausada de manhã e RELIGADA à tarde; 03/11 pausada de novo.
const LOGGI_LIGADA = true;   // 05/11 religada (SÓ o serviço Express). Reserva: quem manda é site_config.frete_loggi.
// 05/11, a TKTX: "só vejo a possibilidade de tirar de SC mesmo, o resto compensa bem mais o cliente pagar Loggi".
// Em SC o SEDEX sai mais barato e chega antes (cotação 05/11: SEDEX R$ 13,18 / 1-2 d × Loggi R$ 16,16 / 2-3 d).
const LOGGI_FORA_UF = ['SC'];
// 12/11, a TKTX: "preciso que o frete Loggi bote +2 dias úteis de entrega, eles estão demorando demais".
// Soma no prazo que o cliente vê (mínimo e máximo) ANTES de escolher os 3 fretes — a comparação com os Correios
// já usa o prazo com a folga. Só a Loggi; Correios segue com o prazo puro do Melhor Envio. Pra tirar: 0.
const LOGGI_DIAS_EXTRA = 2;
function diasExtra(s) {
  return String((s.company && s.company.name) || '').toLowerCase().includes('loggi') ? LOGGI_DIAS_EXTRA : 0;
}
// prazo conhecido + folga; prazo desconhecido (0) continua 0 — nunca vira "2 dias" inventado.
function comFolga(prazo, s) { const n = Number(prazo) || 0; return n > 0 ? n + diasExtra(s) : n; }

// 🎛️ interruptor do banco (mesma tabela que o site já lê com a chave pública). Cache de 60 s por instância;
// 1,5 s de limite — cotação nunca espera o banco.
const SB_URL = 'https://ohwvqnmcfbzdmnucvary.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9od3Zxbm1jZmJ6ZG1udWN2YXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNDUwMzMsImV4cCI6MjA5MjcyMTAzM30.psjpcHImZ4Z8zhprDI_5nzx7veIzwia46DnUkOFUxQ4';
let _cfgLoggi = { t: 0, v: null };
async function loggiLigadaAgora() {
  if (_cfgLoggi.v !== null && Date.now() - _cfgLoggi.t < 60000) return _cfgLoggi.v;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/site_config?chave=eq.frete_loggi&select=valor`,
      { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` }, signal: ctl.signal });
    if (r.ok) {
      const j = await r.json();
      const v = String((Array.isArray(j) && j[0] && j[0].valor) || '').trim().toLowerCase();
      _cfgLoggi = { t: Date.now(), v: v === 'off' ? false : v === 'on' ? true : LOGGI_LIGADA };
      return _cfgLoggi.v;
    }
  } catch (e) { /* banco fora: vale a constante */ } finally { clearTimeout(tm); }
  return LOGGI_LIGADA;
}

function permitido(s, ctx) {
  const emp = String((s.company && s.company.name) || '').toLowerCase();
  const srv = String(s.name || '').toLowerCase();
  // Correios: PAC e SEDEX sempre; Mini Envios SÓ quando cabe (ctx.mini, calculado por pedido).
  // 03/11: Mini Envios aceita até 300 g, 4 cm de altura e seguro de R$ 111,93 (medido no ME). A etiqueta declara
  // R$ 15/pomada (edge melhorenvio) → 5 pomadas = R$ 75. A TKTX embala até 5 no envelope; balm/gel/spray não entram.
  if (emp.includes('correios')) return srv.includes('pac') || srv.includes('sedex') || (srv.includes('mini') && ctx.mini);
  // Loggi: SÓ Express (Coleta não cota em lugar nenhum; Ponto é lenta demais)
  if (emp.includes('loggi')) return ctx.loggi && !ctx.loggiForaUf && srv.includes('express');
  // J&T: pausada
  if (ehJT(s)) return !JT_PAUSADA && !ctx.jtBloqueada;
  // Jadlog, Buslog, Total Express, Azul, LATAM: não autorizadas.
  // Se um dia forem, liberar AQUI, no index.html e conferir o serviceId da edge — os três.
  return false;
}

// 🚫 J&T não aceita Declaração de Conteúdo no CE (testado nas 27 UFs em 08/2026: 26 aceitam,
// só o CE recusa com HTTP 422). Mesma trava existe no index.html (JT_BLOQUEADA_UF).
// Fica registrado mesmo com a J&T pausada — pra não se perder quando ela voltar.
const JT_BLOQUEADA_UF = ['CE'];
function ufDoCep(cep) {
  const n = parseInt(String(cep || '').replace(/\D/g, '').substring(0, 5), 10);
  if (!isFinite(n)) return null;
  if (n <= 19999) return 'SP'; if (n <= 28999) return 'RJ'; if (n <= 29999) return 'ES'; if (n <= 39999) return 'MG';
  if (n <= 48999) return 'BA'; if (n <= 49999) return 'SE'; if (n <= 56999) return 'PE'; if (n <= 57999) return 'AL';
  if (n <= 58999) return 'PB'; if (n <= 59999) return 'RN'; if (n <= 63999) return 'CE'; if (n <= 64999) return 'PI';
  if (n <= 65999) return 'MA'; if (n <= 68899) return 'PA'; if (n <= 68999) return 'AP'; if (n <= 69299) return 'AM';
  if (n <= 69399) return 'RR'; if (n <= 69899) return 'AM'; if (n <= 69999) return 'AC'; if (n <= 73699) return 'DF';
  if (n <= 76799) return 'GO'; if (n <= 76999) return 'RO'; if (n <= 77999) return 'TO'; if (n <= 78899) return 'MT';
  if (n <= 79999) return 'MS'; if (n <= 87999) return 'PR'; if (n <= 89999) return 'SC'; return 'RS';
}
function ehJT(s) {
  const emp = String((s.company && s.company.name) || '').toLowerCase();
  return emp.includes('j&t') || emp.includes('jt express') || emp === 'jet' || emp.startsWith('jet ');
}
function bloqueadaNoCep(cep) { return JT_BLOQUEADA_UF.indexOf(ufDoCep(cep)) >= 0; }
const MINI_MAX_POMADAS = 5;

// ══════════════════════════════════════════════════════════════════════════════
// 🥉 05/11 — OS 3 FRETES QUE O CLIENTE VÊ (no máximo 3, nunca uma lista enorme)
//   1. a melhor PRIVADA (Loggi Express; J&T se um dia voltar) — só se compensar: some quando algum Correios
//      é ao mesmo tempo mais barato-ou-igual E chega antes-ou-junto (aí ela não tem motivo pra aparecer);
//   2. o Correios econômico (o mais barato entre Mini Envios e PAC) — fica mesmo quando a Loggi ganha,
//      porque Correios deixa retirar na agência;
//   3. SEDEX (o mais rápido).
//   Sem privada: Mini Envios, PAC e SEDEX (como antes). Um Correios que o SEDEX supera no preço some (SEDEX
//   sempre chega antes); Mini que custa mais que o PAC some (PAC chega antes).
//   Cotação de 05/11 (27 capitais, 5 pomadas): Loggi aparece em SP, RJ, MG, ES, Nordeste, GO, DF, MT, PA, TO…;
//   some no AM e onde o SEDEX ganha dela (SC). 50 pomadas no AM/RR/AP: SEDEX bate a Loggi → só Correios.
// ══════════════════════════════════════════════════════════════════════════════
function freteEmpresa(s) { return String(s.empresa || '').toLowerCase(); }
function freteNome(s) { return String(s.nome || '').toLowerCase(); }
function maisBarato(l) { return l.reduce((a, b) => (!a || b.preco < a.preco ? b : a), null); }
function prazoOk(n) { return Number(n) > 0; }
// "c" é pelo menos tão bom quanto "x" nas duas coisas que o cliente olha: preço e prazo (só com prazo conhecido).
function domina(c, x) {
  return !!c && !!x && c.preco <= x.preco
    && prazoOk(c.prazo) && prazoOk(x.prazo) && c.prazo <= x.prazo
    && prazoOk(c.prazo_max) && prazoOk(x.prazo_max) && c.prazo_max <= x.prazo_max;
}
export function escolherFretes(lista) {
  const l = (Array.isArray(lista) ? lista : []).filter(s => s && Number(s.preco) > 0);
  const correios = l.filter(s => freteEmpresa(s).includes('correios'));
  const sedex = maisBarato(correios.filter(s => freteNome(s).includes('sedex')));
  let mini = maisBarato(correios.filter(s => freteNome(s).includes('mini')));
  let pac = maisBarato(correios.filter(s => freteNome(s).includes('pac') && !freteNome(s).includes('mini')));
  if (sedex && pac && sedex.preco <= pac.preco) pac = null;     // SEDEX mais barato que o PAC: PAC não tem motivo
  if (sedex && mini && sedex.preco <= mini.preco) mini = null;
  if (pac && mini && pac.preco <= mini.preco) mini = null;      // Mini só vale se for mais barato que o PAC
  const privada = maisBarato(l.filter(s => !freteEmpresa(s).includes('correios')));
  const correiosVivos = [mini, pac, sedex].filter(Boolean);
  const privadaVale = !!privada && !correiosVivos.some(c => domina(c, privada));
  const economico = maisBarato([mini, pac].filter(Boolean));
  const escolha = privadaVale ? [privada, economico, sedex] : [mini, pac, sedex];
  const vistos = new Set();
  return escolha.filter(s => s && !vistos.has(s) && vistos.add(s)).sort((a, b) => a.preco - b.preco).slice(0, 3);
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
    const { cep_destino, unidades, balm, gel, spray, valor } = req.body || {};
    if (!cep_destino) return res.status(400).json({ error: 'Faltou cep_destino' });

    const qPomada = Math.max(0, Number(unidades) || 0);
    const qBalm   = Math.max(0, Number(balm)     || 0);
    const qGel    = Math.max(0, Number(gel)      || 0);
    const qSpray  = Math.max(0, Number(spray)    || 0);   // 13/09: body sem spray = 0 (site antigo segue igual)

    // Antes exigia `unidades`, então pedido SÓ de balm mandava 0 e levava 400 — o site
    // desistia e usava frete estimado. Agora vale qualquer item.
    if (qPomada + qBalm + qGel + qSpray <= 0) {
      return res.status(400).json({ error: 'Pedido sem itens para cotar' });
    }

    const cep = String(cep_destino).replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });

    // Uma caixa só, igual à etiqueta — cotar por `products` faria o Melhor Envio
    // reempacotar por conta dele e devolver um preço que a etiqueta não repete.
    const body = {
      from: { postal_code: '88332490' },
      to:   { postal_code: cep },
      volumes: [{ ...CAIXA, weight: pesoDoPedido(qPomada, qBalm, qGel, qSpray) }],
      options: { insurance_value: Number(valor) || 0, receipt: false, own_hand: false },
    };

    const loggiP = loggiLigadaAgora();   // em paralelo com a cotação
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

    const ctx = {
      jtBloqueada: bloqueadaNoCep(cep),     // vale só pra J&T, quando ela voltar
      mini: qPomada >= 1 && qPomada <= MINI_MAX_POMADAS && qBalm === 0 && qGel === 0 && qSpray === 0,
      loggi: await loggiP,
      loggiForaUf: LOGGI_FORA_UF.indexOf(ufDoCep(cep)) >= 0,   // SC: só Correios
    };

    // menor prazo da faixa = o número que o painel do Melhor Envio exibe (0 se não vier).
    // A conta do ME não tem dias extras (custom == normal); se um dia tiver, manter em 0 —
    // a postagem é avisada à parte no site, não soma aqui.
    const faixa = (s, k) => {
      for (const r of [s.custom_delivery_range, s.delivery_range]) {
        const n = r && Number(r[k]);
        if (n > 0) return n;
      }
      return 0;
    };

    const servicos = data
      .filter(s => !s.error && s.price && permitido(s, ctx))
      .map(s => ({
        id: s.id,
        nome: s.name,
        empresa: (s.company && s.company.name) || '',
        preco: parseFloat(s.custom_price || s.price),
        // 23/09: o MESMO número que o painel do Melhor Envio mostra = o mínimo da faixa de prazo.
        // Conferido 23/09 no mesmo CEP: SEDEX min 1/dt 3 → painel 1; Total min 3/dt 4 → 3; Azul min 2/dt 3 → 2.
        // Antes ia o delivery_time (3) e o site ainda somava a postagem — virava "chega até quinta".
        // A postagem (até 2 dias úteis) NÃO entra aqui: o site avisa à parte, no topo da lista de fretes.
        // 12/11: a Loggi leva +LOGGI_DIAS_EXTRA dias úteis (comFolga); os outros ficam iguais.
        prazo: comFolga(faixa(s, 'min') || s.custom_delivery_time || s.delivery_time, s),
        prazo_max: comFolga(faixa(s, 'max') || s.custom_delivery_time || s.delivery_time, s)
      }))
      .sort((a, b) => a.preco - b.preco);

    return res.status(200).json({ servicos: escolherFretes(servicos) });
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno', detail: String(e) });
  }
}
