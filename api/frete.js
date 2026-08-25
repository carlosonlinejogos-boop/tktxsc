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
const JT_PAUSADA = false;   // 25/08 — pausada de manhã e RELIGADA à tarde: o Carlos preferiu
                            // manter as 4 opções e avisar o cliente das 3 tentativas na tela.
const LOGGI_LIGADA = true;  // 25/08 — em teste, só o serviço Express

function permitido(s) {
  const emp = String((s.company && s.company.name) || '').toLowerCase();
  const srv = String(s.name || '').toLowerCase();
  // Correios: só PAC e SEDEX (Mini Envios tem teto de seguro baixo e volta com erro)
  if (emp.includes('correios')) return srv.includes('pac') || srv.includes('sedex');
  // Loggi: SÓ Express (Coleta não cota em lugar nenhum; Ponto é lenta demais)
  if (emp.includes('loggi')) return LOGGI_LIGADA && srv.includes('express');
  // J&T: pausada
  if (ehJT(s)) return !JT_PAUSADA && !bloqueadaNoCep._ce;
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
bloqueadaNoCep._ce = false;   // preenchido por requisição, antes de filtrar

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

    bloqueadaNoCep._ce = bloqueadaNoCep(cep);   // vale só pra J&T, quando ela voltar

    const servicos = data
      .filter(s => !s.error && s.price && permitido(s))
      .map(s => ({
        id: s.id,
        nome: s.name,
        empresa: (s.company && s.company.name) || '',
        preco: parseFloat(s.custom_price || s.price),
        prazo: s.custom_delivery_time || s.delivery_time
      }))
      .sort((a, b) => a.preco - b.preco);

    return res.status(200).json({ servicos });
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno', detail: String(e) });
  }
}
