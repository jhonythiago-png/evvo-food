// ============================================================
// Evvo Food — Painel do Caixa
// ============================================================

const estado = {
  perfil: null,
  estabelecimento: null,
  comandas: [],
  comandaEmFechamento: null,   // { comanda, itens, subtotal }
  taxaServicoPercentual: 0,
  taxaEntregaValor: 0,
  pagamentos: [],               // [{ forma, valor }]
  historico: [],
  periodoHistorico: 'hoje',
  caixaAtual: null,             // turno de caixa aberto agora (ou null se fechado)
  historicoCaixas: [],
};

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  injetarNavegacao(estado.perfil, 'caixa');

  const { data: estab } = await supabaseClient
    .from('estabelecimentos')
    .select('id, nome, taxa_servico_padrao')
    .eq('id', estado.perfil.estabelecimento_id)
    .single();
  estado.estabelecimento = estab;

  await carregarComandas();
  await carregarStatusCaixa();
  escutarMudancas();
  setInterval(carregarComandas, 5000); // rede de segurança, igual no atendente
}

// ------------------------------------------------------------
// Lista de comandas abertas
// ------------------------------------------------------------
async function carregarComandas() {
  // Se tiver um fechamento em andamento na tela, não atualiza por baixo do usuário
  if (estado.comandaEmFechamento) return;

  const { data, error } = await supabaseClient
    .from('comandas_com_total')
    .select('*')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'aberta')
    .order('aberta_em', { ascending: false });

  if (error) { console.error(error); return; }

  estado.comandas = data || [];
  renderComandas();
}

// ------------------------------------------------------------
// Histórico de comandas fechadas + reimpressão
// ------------------------------------------------------------
function abrirHistorico() {
  document.getElementById('tela-comandas').style.display = 'none';
  document.getElementById('tela-historico').style.display = 'flex';
  selecionarPeriodoHistorico(estado.periodoHistorico);
}

function fecharHistorico() {
  document.getElementById('tela-historico').style.display = 'none';
  document.getElementById('tela-comandas').style.display = 'flex';
}

function selecionarPeriodoHistorico(periodo) {
  estado.periodoHistorico = periodo;
  document.querySelectorAll('.historico-periodo .periodo-chip').forEach(el => el.classList.remove('on'));
  document.getElementById(`chip-historico-${periodo}`).classList.add('on');
  carregarHistorico();
}

async function carregarHistorico() {
  const grid = document.getElementById('grid-historico');
  grid.innerHTML = '<div class="aviso-vazio">Carregando...</div>';

  const hoje = new Date();
  const fim = hoje.toISOString();
  let inicioData;
  if (estado.periodoHistorico === 'hoje') {
    inicioData = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  } else {
    inicioData = new Date(hoje);
    inicioData.setDate(inicioData.getDate() - 6);
    inicioData.setHours(0, 0, 0, 0);
  }

  const { data, error } = await supabaseClient
    .from('fechamentos')
    .select(`
      id, valor_total, subtotal_itens, taxa_servico_percentual, taxa_servico_valor, taxa_entrega_valor, fechado_em,
      comandas!inner ( id, numero_sequencial, tipo, numero_mesa, nome_cliente, identificador_pessoa, telefone_contato, endereco_entrega, estabelecimento_id, status )
    `)
    .eq('comandas.estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('comandas.status', 'fechada')
    .gte('fechado_em', inicioData.toISOString())
    .lte('fechado_em', fim)
    .order('fechado_em', { ascending: false })
    .limit(50);

  if (error) { console.error(error); grid.innerHTML = '<div class="aviso-vazio">Erro ao carregar histórico.</div>'; return; }

  estado.historico = data || [];
  renderHistorico();
}

function renderHistorico() {
  const grid = document.getElementById('grid-historico');
  document.getElementById('contador-historico').textContent =
    `${estado.historico.length} fechada${estado.historico.length !== 1 ? 's' : ''}`;

  if (estado.historico.length === 0) {
    grid.innerHTML = '<div class="aviso-vazio">Nenhuma comanda fechada nesse período.</div>';
    return;
  }

  grid.innerHTML = estado.historico.map(f => {
    const horario = new Date(f.fechado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="historico-linha">
        <div class="historico-info">
          <div class="badge">${rotuloComanda(f.comandas)}</div>
          <div class="detalhe">#${f.comandas.numero_sequencial} · ${horario}</div>
        </div>
        <div class="historico-direita">
          <span class="historico-valor">R$ ${Number(f.valor_total).toFixed(2).replace('.', ',')}</span>
          <button class="btn-ver-historico" onclick="verDetalhesHistorico('${f.id}')">👁️ Ver</button>
          <button class="btn-reimprimir" onclick="solicitarReimpressao('${f.id}')">🖨️ Reimprimir</button>
        </div>
      </div>
    `;
  }).join('');
}

// ------------------------------------------------------------
// Ver detalhes de uma comanda fechada (só consulta, não imprime nada)
// ------------------------------------------------------------
async function verDetalhesHistorico(fechamentoId) {
  const fechamento = estado.historico.find(f => f.id === fechamentoId);
  if (!fechamento) return;

  const comanda = fechamento.comandas;

  document.getElementById('modal-ver-historico-overlay').style.display = 'flex';
  document.getElementById('ver-historico-titulo').textContent = rotuloComanda(comanda);
  document.getElementById('ver-historico-numero').textContent = `Comanda #${comanda.numero_sequencial}`;
  document.getElementById('ver-historico-conteudo').innerHTML = '<div class="aviso-vazio-pequeno">Carregando...</div>';

  const [{ data: itens }, { data: pagamentos }] = await Promise.all([
    supabaseClient
      .from('pedido_itens')
      .select(`
        quantidade, preco_unitario_calculado, observacao,
        itens_cardapio ( nome ),
        pedido_item_ingredientes ( foi_acrescimo, foi_substituicao, ingredientes ( nome ) )
      `)
      .eq('comanda_id', comanda.id)
      .neq('status', 'cancelado'),
    supabaseClient
      .from('pagamentos')
      .select('forma_pagamento, valor, valor_recebido')
      .eq('fechamento_id', fechamentoId),
  ]);

  const nomesFormaPagamento = { dinheiro: 'Dinheiro', debito: 'Cartão Débito', credito: 'Cartão Crédito', pix: 'Pix' };

  // Endereço + telefone — igual sai no cupom, só aparece se for entrega
  const htmlEntrega = comanda.tipo === 'entrega' ? `
    <div class="ver-historico-secao-label">Entrega</div>
    <div class="ver-historico-entrega">
      ${comanda.telefone_contato ? `<div>📞 ${escapeHtml(comanda.telefone_contato)}</div>` : ''}
      ${comanda.endereco_entrega ? `<div>📍 ${escapeHtml(comanda.endereco_entrega)}</div>` : ''}
      ${!comanda.telefone_contato && !comanda.endereco_entrega ? '<div class="aviso-vazio-pequeno">Nenhum dado de entrega registrado.</div>' : ''}
    </div>
  ` : '';

  const htmlItens = (itens || []).map(item => {
    const sabores = item.pedido_item_ingredientes.filter(s => !s.foi_acrescimo && !s.foi_substituicao).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    const substituicoes = item.pedido_item_ingredientes.filter(s => s.foi_substituicao).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    const acrescimos = item.pedido_item_ingredientes.filter(s => s.foi_acrescimo).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    return `
      <div class="ver-historico-item">
        <div class="ver-historico-item-topo">
          <span>${item.quantidade}× ${escapeHtml(item.itens_cardapio.nome)}</span>
          <span>R$ ${(item.preco_unitario_calculado * item.quantidade).toFixed(2).replace('.', ',')}</span>
        </div>
        ${sabores ? `<div class="ver-historico-item-detalhe">${sabores}</div>` : ''}
        ${item.observacao ? `<div class="ver-historico-item-detalhe">${escapeHtml(item.observacao)}</div>` : ''}
        ${substituicoes ? `<div class="ver-historico-item-detalhe">Substituído por: ${substituicoes}</div>` : ''}
        ${acrescimos ? `<div class="ver-historico-item-detalhe">+ ACRÉSCIMO: ${acrescimos}</div>` : ''}
      </div>
    `;
  }).join('');

  // Subtotal + taxas — igual sai no cupom, cada linha só aparece se tiver valor
  const htmlValores = `
    <div class="ver-historico-pagamento">
      <span>Subtotal</span>
      <span>R$ ${Number(fechamento.subtotal_itens).toFixed(2).replace('.', ',')}</span>
    </div>
    ${Number(fechamento.taxa_servico_valor) > 0 ? `
      <div class="ver-historico-pagamento">
        <span>Taxa de serviço (${fechamento.taxa_servico_percentual}%)</span>
        <span>R$ ${Number(fechamento.taxa_servico_valor).toFixed(2).replace('.', ',')}</span>
      </div>
    ` : ''}
    ${Number(fechamento.taxa_entrega_valor) > 0 ? `
      <div class="ver-historico-pagamento">
        <span>Taxa de entrega</span>
        <span>R$ ${Number(fechamento.taxa_entrega_valor).toFixed(2).replace('.', ',')}</span>
      </div>
    ` : ''}
  `;

  const htmlPagamentos = (pagamentos || []).map(p => {
    const temTroco = p.forma_pagamento === 'dinheiro' && p.valor_recebido;
    const troco = temTroco ? round2(p.valor_recebido - p.valor) : 0;
    return `
      <div class="ver-historico-pagamento">
        <span>${nomesFormaPagamento[p.forma_pagamento] || p.forma_pagamento}</span>
        <span>R$ ${Number(p.valor).toFixed(2).replace('.', ',')}</span>
      </div>
      ${temTroco ? `
        <div class="ver-historico-item-detalhe" style="margin-bottom:6px;">
          Cliente pagou com R$ ${Number(p.valor_recebido).toFixed(2).replace('.', ',')} — troco: R$ ${troco.toFixed(2).replace('.', ',')}
        </div>
      ` : ''}
    `;
  }).join('');

  document.getElementById('ver-historico-conteudo').innerHTML = `
    ${htmlEntrega}
    <div class="ver-historico-secao-label">Itens</div>
    ${htmlItens || '<div class="aviso-vazio-pequeno">Nenhum item.</div>'}
    <div class="ver-historico-secao-label">Valores</div>
    ${htmlValores}
    <div class="ver-historico-secao-label">Pagamento</div>
    ${htmlPagamentos || '<div class="aviso-vazio-pequeno">Nenhum pagamento registrado.</div>'}
    <div class="ver-historico-total">
      <span>TOTAL</span>
      <span>R$ ${Number(fechamento.valor_total).toFixed(2).replace('.', ',')}</span>
    </div>
  `;
}

function fecharVerHistorico() {
  document.getElementById('modal-ver-historico-overlay').style.display = 'none';
}

async function solicitarReimpressao(fechamentoId) {
  const fechamento = estado.historico.find(f => f.id === fechamentoId);
  if (!fechamento) return;

  const { error } = await supabaseClient.from('solicitacoes_impressao').insert({
    comanda_id: fechamento.comandas.id,
    fechamento_id: fechamentoId,
    tipo: 'reimpressao_fechamento',
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao pedir reimpressão.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Reimpressão enviada! 🖨️');
}

function escutarMudancas() {
  supabaseClient
    .channel('caixa_mudancas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas' }, () => carregarComandas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_itens' }, () => carregarComandas())
    .subscribe();
}

function rotuloComanda(c) {
  if (c.tipo === 'mesa') {
    return c.identificador_pessoa ? `Mesa ${c.numero_mesa} · ${escapeHtml(c.identificador_pessoa)}` : `Mesa ${c.numero_mesa}`;
  }
  if (c.tipo === 'entrega') return `Entrega · ${escapeHtml(c.nome_cliente) || ''}`;
  return escapeHtml(c.nome_cliente) || 'Balcão';
}

function tempoAberta(dataIso) {
  const minutos = Math.floor((Date.now() - new Date(dataIso).getTime()) / 60000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `há ${horas}h${minutos % 60 > 0 ? (minutos % 60) + 'min' : ''}`;
}

const ROTULO_ESTAGIO_ENTREGA = {
  preparando: { texto: '🟡 Preparando', classe: 'preparando' },
  saiu_entrega: { texto: '🔵 Saiu pra entrega', classe: 'saiu' },
  entregue: { texto: '🟢 Entregue', classe: 'entregue' },
};

function renderComandas() {
  const grid = document.getElementById('grid-comandas');
  const contador = document.getElementById('contador-comandas');
  contador.textContent = `${estado.comandas.length} aberta${estado.comandas.length !== 1 ? 's' : ''}`;

  if (estado.comandas.length === 0) {
    grid.innerHTML = '<div class="aviso-vazio">Nenhuma comanda aberta no momento.</div>';
    return;
  }

  grid.innerHTML = estado.comandas.map(c => {
    const ehEntrega = c.tipo === 'entrega';
    const estagio = ehEntrega ? ROTULO_ESTAGIO_ENTREGA[c.status_entrega || 'preparando'] : null;

    // Se já saiu pra entrega, clicar no card não reabre o fechamento inteiro —
    // só pede confirmação rápida de "voltou e entregou"
    const acaoClick = (ehEntrega && c.status_entrega === 'saiu_entrega')
      ? `confirmarEntregaRealizada('${c.id}')`
      : `abrirFechamento('${c.id}')`;

    return `
    <button class="ticket-card" onclick="${acaoClick}">
      <div class="ticket-row1">
        <span class="badge">${rotuloComanda(c)}</span>
        <span class="dot"></span>
      </div>
      <div class="ticket-numero">Comanda #${c.numero_sequencial}</div>
      <div class="ticket-tempo">${tempoAberta(c.aberta_em)}</div>
      ${estagio ? `<div class="estagio-entrega ${estagio.classe}">${estagio.texto}</div>` : ''}
      <div class="ticket-divisor"></div>
      <div class="ticket-total-row">
        <span class="label">parcial</span>
        <span class="valor">R$ ${Number(c.total_parcial).toFixed(2).replace('.', ',')}</span>
      </div>
    </button>
  `;
  }).join('');
}

async function confirmarEntregaRealizada(comandaId) {
  mostrarConfirmacaoGenerica(
    'O motoboy voltou e a entrega foi realizada? Isso vai fechar a conta de verdade.',
    async () => {
      const { error } = await supabaseClient
        .from('comandas')
        .update({ status_entrega: 'entregue', status: 'fechada', fechada_em: new Date().toISOString() })
        .eq('id', comandaId);

      if (error) { mostrarToast('Erro ao confirmar entrega.', 'erro'); return; }

      mostrarToast('Entrega confirmada e conta fechada!');
      await carregarComandas();
    }
  );
}

// ------------------------------------------------------------
// Modal de confirmação genérico — substitui o confirm() nativo,
// que não é confiável em apps salvos na tela inicial do iPhone
// ------------------------------------------------------------
let acaoConfirmacaoPendente = null;

function mostrarConfirmacaoGenerica(mensagem, aoConfirmar) {
  document.getElementById('confirmacao-generica-texto').textContent = mensagem;
  acaoConfirmacaoPendente = aoConfirmar;
  document.getElementById('modal-confirmacao-generica-overlay').style.display = 'flex';
}

function fecharModalConfirmacaoGenerica() {
  document.getElementById('modal-confirmacao-generica-overlay').style.display = 'none';
  acaoConfirmacaoPendente = null;
}

async function executarConfirmacaoGenerica() {
  const acao = acaoConfirmacaoPendente;
  fecharModalConfirmacaoGenerica();
  if (acao) await acao();
}

// ------------------------------------------------------------
// Tela de fechamento
// ------------------------------------------------------------
async function abrirFechamento(comandaId) {
  const comanda = estado.comandas.find(c => c.id === comandaId);
  if (!comanda) return;

  const { data: itens, error } = await supabaseClient
    .from('pedido_itens')
    .select(`
      id, item_cardapio_id, quantidade, observacao, preco_unitario_calculado, status,
      itens_cardapio ( nome ),
      pedido_item_ingredientes ( ingrediente_id, foi_acrescimo, foi_substituicao, preco_acrescimo_aplicado, ingredientes ( nome ) )
    `)
    .eq('comanda_id', comandaId)
    .neq('status', 'cancelado');

  if (error) { mostrarToast('Erro ao carregar itens.', 'erro'); return; }

  // Busca outras comandas abertas na MESMA mesa (outras pessoas na mesa 04, por ex.)
  // — usado pra permitir "transferir item" quando o atendente anotou na pessoa errada
  let comandasIrmas = [];
  if (comanda.tipo === 'mesa' && comanda.numero_mesa) {
    const { data: irmas } = await supabaseClient
      .from('comandas')
      .select('id, numero_sequencial, identificador_pessoa')
      .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
      .eq('tipo', 'mesa')
      .eq('numero_mesa', comanda.numero_mesa)
      .eq('status', 'aberta')
      .neq('id', comandaId);
    comandasIrmas = irmas || [];
  }

  estado.comandaEmFechamento = { comanda, itens: itens || [], comandasIrmas };
  estado.taxaServicoPercentual = Number(estado.estabelecimento?.taxa_servico_padrao || 0);
  estado.taxaEntregaValor = Number(comanda.taxa_entrega || 0);
  estado.pagamentos = [];

  renderFechamento();
  document.getElementById('tela-comandas').style.display = 'none';
  document.getElementById('tela-fechamento').style.display = 'flex';
}

function fecharTelaFechamento() {
  estado.comandaEmFechamento = null;
  document.getElementById('tela-fechamento').style.display = 'none';
  document.getElementById('tela-comandas').style.display = 'flex';
  carregarComandas();
}

function calcularValores() {
  const { itens } = estado.comandaEmFechamento;
  const subtotal = round2(itens.reduce((soma, item) => soma + item.preco_unitario_calculado * item.quantidade, 0));
  const taxaValor = round2(subtotal * estado.taxaServicoPercentual / 100);
  const total = round2(subtotal + taxaValor + estado.taxaEntregaValor);
  return { subtotal, taxaValor, total };
}

function round2(n) { return Math.round(n * 100) / 100; }

function renderFechamento() {
  const { comanda, itens, comandasIrmas } = estado.comandaEmFechamento;
  const { subtotal, taxaValor, total } = calcularValores();

  document.getElementById('fechamento-titulo').textContent = rotuloComanda(comanda);
  document.getElementById('fechamento-codigo').textContent = `COMANDA #${comanda.numero_sequencial}`;

  const temIrmas = comandasIrmas && comandasIrmas.length > 0;

  document.getElementById('fechamento-itens').innerHTML = itens.map(item => {
    const sabores = item.pedido_item_ingredientes.filter(s => !s.foi_acrescimo && !s.foi_substituicao).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    const substituicoes = item.pedido_item_ingredientes.filter(s => s.foi_substituicao).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    const acrescimos = item.pedido_item_ingredientes.filter(s => s.foi_acrescimo).map(s => escapeHtml(s.ingredientes.nome)).join(', ');
    return `
      <div class="fechamento-item-linha">
        <div>
          <div class="item-nome">${item.quantidade}× ${escapeHtml(item.itens_cardapio.nome)}</div>
          ${sabores ? `<div class="item-detalhe">${sabores}</div>` : ''}
          ${item.observacao ? `<div class="item-detalhe">${escapeHtml(item.observacao)}</div>` : ''}
          ${substituicoes ? `<div class="item-detalhe">Substituído por: ${substituicoes}</div>` : ''}
          ${acrescimos ? `<div class="item-detalhe">+ ACRÉSCIMO: ${acrescimos}</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="item-valor">R$ ${(item.preco_unitario_calculado * item.quantidade).toFixed(2).replace('.', ',')}</span>
          ${temIrmas ? `<button class="btn-transferir" onclick="abrirTransferencia('${item.id}')" title="Transferir pra outra pessoa da mesa">⇄</button>` : ''}
          <button class="btn-remover" onclick="removerItemFechamento('${item.id}')" title="Remover item (não cobrar)">✕</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('input-taxa-servico').value = estado.taxaServicoPercentual.toString().replace('.', ',');
  document.getElementById('input-taxa-entrega').value = estado.taxaEntregaValor.toString().replace('.', ',');

  document.getElementById('valor-subtotal').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('valor-taxa-servico').textContent = `R$ ${taxaValor.toFixed(2).replace('.', ',')}`;
  const linhaTaxaEntrega = document.getElementById('linha-resumo-taxa-entrega');
  if (estado.taxaEntregaValor > 0) {
    linhaTaxaEntrega.style.display = 'flex';
    document.getElementById('valor-taxa-entrega-resumo').textContent = `R$ ${Number(estado.taxaEntregaValor).toFixed(2).replace('.', ',')}`;
  } else {
    linhaTaxaEntrega.style.display = 'none';
  }
  document.getElementById('valor-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;

  // Se for comanda de entrega ainda não despachada, o botão final não "fecha"
  // de vez — só define a forma de pagamento e avança pra "saiu pra entrega"
  const ehSaidaEntrega = comanda.tipo === 'entrega' && comanda.status_entrega !== 'entregue';
  document.getElementById('btn-fechar-conta').textContent = ehSaidaEntrega
    ? 'Confirmar saída pra entrega'
    : 'Fechar conta';

  renderPagamentos();
}

/** Converte texto digitado (aceita vírgula ou ponto) pra número */
function paraNumero(texto) {
  if (typeof texto !== 'string') return Number(texto) || 0;
  return parseFloat(texto.replace(',', '.')) || 0;
}

/**
 * Remove um item da conta (não cobra) — pra quando o atendente
 * lançou algo errado por engano e o cliente não consumiu aquilo.
 * Marca como cancelado no banco e recalcula tudo na hora.
 */
async function removerItemFechamento(itemId) {
  const item = estado.comandaEmFechamento.itens.find(i => i.id === itemId);
  if (!item) return;

  mostrarConfirmacaoGenerica(
    `Remover "${item.quantidade}× ${item.itens_cardapio.nome}" da conta? Isso não vai ser cobrado.`,
    async () => {
      const { error } = await supabaseClient
        .from('pedido_itens')
        .update({ status: 'cancelado' })
        .eq('id', itemId);

      if (error) {
        mostrarToast('Erro ao remover item.', 'erro');
        return;
      }

      estado.comandaEmFechamento.itens = estado.comandaEmFechamento.itens.filter(i => i.id !== itemId);
      renderFechamento();
      mostrarToast('Item removido da conta.');
    }
  );
}

// ------------------------------------------------------------
// Transferir item pra outra pessoa da MESMA mesa
// (corrige quando o atendente anotou na comanda errada)
// ------------------------------------------------------------
let itemParaTransferirId = null;

function abrirTransferencia(itemId) {
  itemParaTransferirId = itemId;
  const item = estado.comandaEmFechamento.itens.find(i => i.id === itemId);
  const { comandasIrmas } = estado.comandaEmFechamento;

  document.getElementById('transferencia-item-nome').textContent =
    `${item.quantidade}× ${item.itens_cardapio.nome}`;

  // Se for só 1 unidade, nem mostra o seletor de quantidade (não tem o que escolher)
  const seletorQtd = document.getElementById('transferencia-qtd-container');
  if (item.quantidade > 1) {
    seletorQtd.style.display = 'block';
    document.getElementById('input-transferencia-qtd').max = item.quantidade;
    document.getElementById('input-transferencia-qtd').value = item.quantidade;
  } else {
    seletorQtd.style.display = 'none';
  }

  document.getElementById('lista-comandas-irmas').innerHTML = comandasIrmas.map(c => `
    <button class="btn-ghost btn-comanda-irma" onclick="confirmarTransferencia('${c.id}')">
      ${c.identificador_pessoa ? escapeHtml(c.identificador_pessoa) : ('Comanda #' + c.numero_sequencial)}
    </button>
  `).join('');

  document.getElementById('modal-transferencia-overlay').style.display = 'flex';
}

function fecharModalTransferencia() {
  document.getElementById('modal-transferencia-overlay').style.display = 'none';
  itemParaTransferirId = null;
}

async function confirmarTransferencia(comandaDestinoId) {
  const item = estado.comandaEmFechamento.itens.find(i => i.id === itemParaTransferirId);
  if (!item) return;

  const inputQtd = document.getElementById('input-transferencia-qtd');
  const qtdTransferir = item.quantidade > 1 ? (parseInt(inputQtd.value) || 1) : item.quantidade;

  if (qtdTransferir < 1 || qtdTransferir > item.quantidade) {
    mostrarToast('Quantidade inválida.', 'erro');
    return;
  }

  try {
    if (qtdTransferir === item.quantidade) {
      // Transfere a linha inteira — só muda de qual comanda ela pertence
      const { error } = await supabaseClient
        .from('pedido_itens')
        .update({ comanda_id: comandaDestinoId })
        .eq('id', item.id);
      if (error) throw error;

    } else {
      // Transferência PARCIAL: diminui a quantidade na linha original
      // e cria uma linha nova na comanda de destino com a quantidade transferida
      const { error: erroReduzir } = await supabaseClient
        .from('pedido_itens')
        .update({ quantidade: item.quantidade - qtdTransferir })
        .eq('id', item.id);
      if (erroReduzir) throw erroReduzir;

      const { data: novaLinha, error: erroNovaLinha } = await supabaseClient
        .from('pedido_itens')
        .insert({
          comanda_id: comandaDestinoId,
          item_cardapio_id: item.item_cardapio_id,
          quantidade: qtdTransferir,
          preco_unitario_calculado: item.preco_unitario_calculado,
          observacao: item.observacao,
          status: item.status,
          criado_por: estado.perfil.id,
        })
        .select()
        .single();
      if (erroNovaLinha) throw erroNovaLinha;

      // Copia os sabores/acréscimos da linha original pra linha nova
      if (item.pedido_item_ingredientes.length > 0) {
        const copiaSabores = item.pedido_item_ingredientes.map(s => ({
          pedido_item_id: novaLinha.id,
          ingrediente_id: s.ingrediente_id,
          foi_acrescimo: s.foi_acrescimo,
          foi_substituicao: s.foi_substituicao || false,
          preco_acrescimo_aplicado: s.preco_acrescimo_aplicado,
        }));
        await supabaseClient.from('pedido_item_ingredientes').insert(copiaSabores);
      }
    }

    // Atualiza a tela: remove a linha (se foi tudo) ou ajusta a quantidade (se foi parcial)
    if (qtdTransferir === item.quantidade) {
      estado.comandaEmFechamento.itens = estado.comandaEmFechamento.itens.filter(i => i.id !== item.id);
    } else {
      item.quantidade -= qtdTransferir;
    }
    renderFechamento();
    fecharModalTransferencia();
    mostrarToast('Item transferido!');

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao transferir item.', 'erro');
  }
}

function atualizarTaxaServico(valor) {
  estado.taxaServicoPercentual = paraNumero(valor);
  atualizarResumoValores();
}

function atualizarTaxaEntrega(valor) {
  estado.taxaEntregaValor = paraNumero(valor);
  atualizarResumoValores();
}

/** Recalcula só os valores exibidos (subtotal/taxa/total) — não mexe
 * nos campos de input, pra não atrapalhar quem está digitando */
function atualizarResumoValores() {
  const { subtotal, taxaValor, total } = calcularValores();
  document.getElementById('valor-subtotal').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('valor-taxa-servico').textContent = `R$ ${taxaValor.toFixed(2).replace('.', ',')}`;
  const linhaTaxaEntrega = document.getElementById('linha-resumo-taxa-entrega');
  if (estado.taxaEntregaValor > 0) {
    linhaTaxaEntrega.style.display = 'flex';
    document.getElementById('valor-taxa-entrega-resumo').textContent = `R$ ${Number(estado.taxaEntregaValor).toFixed(2).replace('.', ',')}`;
  } else {
    linhaTaxaEntrega.style.display = 'none';
  }
  document.getElementById('valor-total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  renderResumoPagamento();
}

// ------------------------------------------------------------
// Split de pagamento
// ------------------------------------------------------------
function adicionarPagamento() {
  const { total } = calcularValores();
  const totalJaAlocado = estado.pagamentos.reduce((s, p) => s + p.valor, 0);
  const restante = round2(total - totalJaAlocado);

  estado.pagamentos.push({ forma: 'dinheiro', valor: restante > 0 ? restante : 0 });
  renderPagamentos();
}

function removerPagamento(index) {
  estado.pagamentos.splice(index, 1);
  renderPagamentos();
}

function atualizarFormaPagamento(index, forma) {
  estado.pagamentos[index].forma = forma;
}

function atualizarValorPagamento(index, valor) {
  estado.pagamentos[index].valor = paraNumero(valor);
  renderResumoPagamento();
}

function renderPagamentos() {
  const lista = document.getElementById('lista-pagamentos');

  if (estado.pagamentos.length === 0) {
    lista.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma forma de pagamento adicionada</div>';
  } else {
    lista.innerHTML = estado.pagamentos.map((p, i) => {
      const mostrarTroco = p.forma === 'dinheiro';
      return `
      <div class="pagamento-linha">
        <select onchange="atualizarFormaPagamento(${i}, this.value)">
          <option value="dinheiro" ${p.forma === 'dinheiro' ? 'selected' : ''}>Dinheiro</option>
          <option value="debito" ${p.forma === 'debito' ? 'selected' : ''}>Cartão Débito</option>
          <option value="credito" ${p.forma === 'credito' ? 'selected' : ''}>Cartão Crédito</option>
          <option value="pix" ${p.forma === 'pix' ? 'selected' : ''}>Pix</option>
        </select>
        <input type="text" inputmode="decimal" value="${p.valor.toString().replace('.', ',')}" oninput="atualizarValorPagamento(${i}, this.value)">
        <button class="btn-remover" onclick="removerPagamento(${i})">✕</button>
      </div>
      ${mostrarTroco ? `
        <div class="troco-linha">
          <label>Cliente vai pagar com quanto?</label>
          <input type="text" inputmode="decimal" placeholder="Ex: 50,00"
                 value="${p.valorRecebido ? p.valorRecebido.toString().replace('.', ',') : ''}"
                 oninput="atualizarValorRecebido(${i}, this.value)">
          <span class="troco-resultado" id="troco-resultado-${i}"></span>
        </div>
      ` : ''}
      `;
    }).join('');

    // Preenche o resultado do troco de cada linha SEM precisar redesenhar
    // (redesenhar destruía o campo e fechava o teclado do celular a cada tecla)
    estado.pagamentos.forEach((p, i) => atualizarTextoTroco(i));
  }

  renderResumoPagamento();
}

function atualizarTextoTroco(index) {
  const p = estado.pagamentos[index];
  const el = document.getElementById(`troco-resultado-${index}`);
  if (!el) return;
  if (p.forma === 'dinheiro' && p.valorRecebido) {
    const troco = round2(p.valorRecebido - p.valor);
    el.textContent = `Troco: R$ ${troco.toFixed(2).replace('.', ',')}`;
  } else {
    el.textContent = '';
  }
}

function atualizarValorRecebido(index, valor) {
  estado.pagamentos[index].valorRecebido = paraNumero(valor);
  atualizarTextoTroco(index);
}

function renderResumoPagamento() {
  const { total } = calcularValores();
  const totalPago = round2(estado.pagamentos.reduce((s, p) => s + (p.valor || 0), 0));
  const diferenca = round2(total - totalPago);

  document.getElementById('resumo-total-pago').textContent = `R$ ${totalPago.toFixed(2).replace('.', ',')}`;

  const elDiferenca = document.getElementById('resumo-diferenca');
  elDiferenca.textContent = `R$ ${diferenca.toFixed(2).replace('.', ',')}`;
  elDiferenca.className = diferenca === 0 ? 'ok' : (diferenca > 0 ? 'faltando' : 'sobrando');

  document.getElementById('btn-fechar-conta').disabled = diferenca !== 0 || estado.pagamentos.length === 0;
}

// ------------------------------------------------------------
// Confirmar fechamento
// ------------------------------------------------------------
async function confirmarFechamento() {
  const { comanda } = estado.comandaEmFechamento;
  const { subtotal, taxaValor, total } = calcularValores();
  const ehSaidaEntrega = comanda.tipo === 'entrega' && comanda.status_entrega !== 'entregue';

  const btn = document.getElementById('btn-fechar-conta');
  btn.disabled = true;
  btn.textContent = ehSaidaEntrega ? 'Confirmando saída...' : 'Fechando...';

  try {
    const { data: fechamento, error: erroFechamento } = await supabaseClient
      .from('fechamentos')
      .insert({
        comanda_id: comanda.id,
        subtotal_itens: subtotal,
        taxa_servico_percentual: estado.taxaServicoPercentual,
        taxa_servico_valor: taxaValor,
        taxa_entrega_valor: estado.taxaEntregaValor,
        valor_total: total,
        fechado_por: estado.perfil.id,
      })
      .select()
      .single();

    if (erroFechamento) throw erroFechamento;

    const linhasPagamento = estado.pagamentos.map(p => ({
      fechamento_id: fechamento.id,
      forma_pagamento: p.forma,
      valor: p.valor,
      valor_recebido: p.forma === 'dinheiro' && p.valorRecebido ? p.valorRecebido : null,
    }));

    const { error: erroPagamentos } = await supabaseClient.from('pagamentos').insert(linhasPagamento);
    if (erroPagamentos) throw erroPagamentos;

    if (ehSaidaEntrega) {
      // Não fecha de vez — só avança pro estágio "saiu pra entrega".
      // A comanda continua "aberta" até o motoboy voltar e confirmar.
      const { error: erroComanda } = await supabaseClient
        .from('comandas')
        .update({ status_entrega: 'saiu_entrega' })
        .eq('id', comanda.id);
      if (erroComanda) throw erroComanda;

      mostrarToast('Saiu pra entrega! Cupom com a forma de pagamento vai ser impresso. 🛵');
    } else {
      const { error: erroComanda } = await supabaseClient
        .from('comandas')
        .update({ status: 'fechada', fechada_em: new Date().toISOString() })
        .eq('id', comanda.id);
      if (erroComanda) throw erroComanda;

      mostrarToast('Conta fechada com sucesso! 🎉');
    }

    fecharTelaFechamento();

  } catch (erro) {
    console.error(erro);
    mostrarToast('Erro ao processar. Tente de novo.', 'erro');
    btn.disabled = false;
    btn.textContent = ehSaidaEntrega ? 'Confirmar saída pra entrega' : 'Fechar conta';
  }
}

// ============================================================
// Abertura e Fechamento de Caixa (turno)
// ============================================================

const NOMES_FORMA_PAGAMENTO_CAIXA = { dinheiro: 'Dinheiro', debito: 'Cartão Débito', credito: 'Cartão Crédito', pix: 'Pix' };

async function carregarStatusCaixa() {
  const { data, error } = await supabaseClient
    .from('caixas_turno')
    .select('id, status, aberto_em, valor_abertura, aberto_por')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'aberto')
    .order('aberto_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { console.error(error); return; }

  estado.caixaAtual = data || null;
  renderStatusCaixa();
}

function renderStatusCaixa() {
  const badge = document.getElementById('caixa-status-badge');
  const detalhe = document.getElementById('caixa-status-detalhe');
  const btnAcao = document.getElementById('btn-caixa-acao');

  if (estado.caixaAtual) {
    badge.textContent = '🔓 Caixa aberto';
    badge.className = 'caixa-status-badge aberto';
    const horario = new Date(estado.caixaAtual.aberto_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    detalhe.textContent = `desde ${horario} · troco inicial R$ ${Number(estado.caixaAtual.valor_abertura).toFixed(2).replace('.', ',')}`;
    btnAcao.textContent = '🔒 Fechar Caixa';
    btnAcao.style.display = 'block';
  } else {
    badge.textContent = '🔒 Caixa fechado';
    badge.className = 'caixa-status-badge fechado';
    detalhe.textContent = 'abre o caixa pra começar a operar o turno';
    btnAcao.textContent = '🔓 Abrir Caixa';
    btnAcao.style.display = 'block';
  }
}

function cliqueBotaoCaixa() {
  if (estado.caixaAtual) {
    abrirModalFecharCaixa();
  } else {
    abrirModalAbrirCaixa();
  }
}

// ------------------------------------------------------------
// Abrir caixa
// ------------------------------------------------------------
function abrirModalAbrirCaixa() {
  document.getElementById('input-abrir-caixa-valor').value = '';
  document.getElementById('modal-abrir-caixa-overlay').style.display = 'flex';
}

function fecharModalAbrirCaixa() {
  document.getElementById('modal-abrir-caixa-overlay').style.display = 'none';
}

async function confirmarAberturaCaixa() {
  const valorTexto = document.getElementById('input-abrir-caixa-valor').value;
  const valor = parseFloat((valorTexto || '0').replace(',', '.')) || 0;

  const { error } = await supabaseClient.from('caixas_turno').insert({
    estabelecimento_id: estado.perfil.estabelecimento_id,
    aberto_por: estado.perfil.id,
    valor_abertura: valor,
    status: 'aberto',
  });

  if (error) {
    mostrarToast('Erro ao abrir caixa.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Caixa aberto! 🔓');
  fecharModalAbrirCaixa();
  await carregarStatusCaixa();
}

// ------------------------------------------------------------
// Fechar caixa — a parte que calcula tudo
// ------------------------------------------------------------
async function abrirModalFecharCaixa() {
  if (!estado.caixaAtual) return;

  document.getElementById('input-fechar-caixa-contado').value = '';
  document.getElementById('fechar-caixa-diferenca').style.display = 'none';
  document.getElementById('fechar-caixa-resumo-formas').innerHTML = '<div class="aviso-vazio-pequeno">Calculando...</div>';
  document.getElementById('fechar-caixa-conferencia').innerHTML = '';
  document.getElementById('modal-fechar-caixa-overlay').style.display = 'flex';

  const inicio = estado.caixaAtual.aberto_em;
  const fim = new Date().toISOString();

  const inicioTexto = new Date(inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  document.getElementById('fechar-caixa-periodo').textContent = `Turno desde ${inicioTexto} até agora`;

  // Busca todos os pagamentos de comandas fechadas nesse período — em 2 passos
  // simples, pra evitar filtro em consulta aninhada de 2 níveis (que o
  // Supabase não processa direito e causava erro)
  const { data: fechamentosNoTurno, error: erroFechamentos } = await supabaseClient
    .from('fechamentos')
    .select('id, comandas!inner(estabelecimento_id)')
    .eq('comandas.estabelecimento_id', estado.perfil.estabelecimento_id)
    .gte('fechado_em', inicio)
    .lte('fechado_em', fim);

  if (erroFechamentos) {
    console.error(erroFechamentos);
    document.getElementById('fechar-caixa-resumo-formas').innerHTML = '<div class="aviso-vazio-pequeno">Erro ao calcular.</div>';
    return;
  }

  const idsFechamentos = (fechamentosNoTurno || []).map(f => f.id);

  let pagamentos = [];
  if (idsFechamentos.length > 0) {
    const { data, error } = await supabaseClient
      .from('pagamentos')
      .select('forma_pagamento, valor')
      .in('fechamento_id', idsFechamentos);

    if (error) {
      console.error(error);
      document.getElementById('fechar-caixa-resumo-formas').innerHTML = '<div class="aviso-vazio-pequeno">Erro ao calcular.</div>';
      return;
    }
    pagamentos = data || [];
  }

  const totaisPorForma = {};
  for (const p of pagamentos || []) {
    totaisPorForma[p.forma_pagamento] = (totaisPorForma[p.forma_pagamento] || 0) + Number(p.valor);
  }

  const totalGeral = Object.values(totaisPorForma).reduce((s, v) => s + v, 0);
  const dinheiroRecebido = totaisPorForma['dinheiro'] || 0;

  // Ajustes de caixa registrados durante o turno também entram na conferência
  const { data: ajustes } = await supabaseClient
    .from('ajustes_caixa')
    .select('valor')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .gte('criado_em', inicio)
    .lte('criado_em', fim);

  const somaAjustes = (ajustes || []).reduce((s, a) => s + Number(a.valor), 0);

  const valorEsperado = Number(estado.caixaAtual.valor_abertura) + dinheiroRecebido + somaAjustes;

  // Guarda esses valores calculados no estado, pra usar quando confirmar o fechamento
  estado.caixaAtual._calculo = { totaisPorForma, totalGeral, dinheiroRecebido, somaAjustes, valorEsperado };

  document.getElementById('fechar-caixa-resumo-formas').innerHTML = `
    ${Object.entries(totaisPorForma).map(([forma, valor]) => `
      <div class="fechar-caixa-linha">
        <span>${NOMES_FORMA_PAGAMENTO_CAIXA[forma] || forma}</span>
        <span>R$ ${valor.toFixed(2).replace('.', ',')}</span>
      </div>
    `).join('') || '<div class="aviso-vazio-pequeno">Nenhum pagamento registrado nesse turno.</div>'}
    <div class="fechar-caixa-linha total">
      <span>Total recebido no turno</span>
      <span>R$ ${totalGeral.toFixed(2).replace('.', ',')}</span>
    </div>
  `;

  document.getElementById('fechar-caixa-conferencia').innerHTML = `
    <div class="fechar-caixa-linha">
      <span>Troco inicial (abertura)</span>
      <span>R$ ${Number(estado.caixaAtual.valor_abertura).toFixed(2).replace('.', ',')}</span>
    </div>
    <div class="fechar-caixa-linha">
      <span>+ Dinheiro recebido no turno</span>
      <span>R$ ${dinheiroRecebido.toFixed(2).replace('.', ',')}</span>
    </div>
    <div class="fechar-caixa-linha">
      <span>+ Ajustes de caixa</span>
      <span>R$ ${somaAjustes.toFixed(2).replace('.', ',')}</span>
    </div>
    <div class="fechar-caixa-linha esperado">
      <span>= Esperado na gaveta</span>
      <span>R$ ${valorEsperado.toFixed(2).replace('.', ',')}</span>
    </div>
  `;
}

function fecharModalFecharCaixa() {
  document.getElementById('modal-fechar-caixa-overlay').style.display = 'none';
}

function atualizarDiferencaFechamento() {
  if (!estado.caixaAtual?._calculo) return;

  const contadoTexto = document.getElementById('input-fechar-caixa-contado').value;
  const elDiferenca = document.getElementById('fechar-caixa-diferenca');

  if (!contadoTexto) {
    elDiferenca.style.display = 'none';
    return;
  }

  const contado = parseFloat(contadoTexto.replace(',', '.')) || 0;
  const diferenca = round2(contado - estado.caixaAtual._calculo.valorEsperado);

  elDiferenca.style.display = 'block';
  if (Math.abs(diferenca) < 0.01) {
    elDiferenca.className = 'bateu';
    elDiferenca.textContent = '✅ Bateu certinho!';
  } else if (diferenca < 0) {
    elDiferenca.className = 'faltando';
    elDiferenca.textContent = `⚠️ Faltando R$ ${Math.abs(diferenca).toFixed(2).replace('.', ',')}`;
  } else {
    elDiferenca.className = 'sobrando';
    elDiferenca.textContent = `💰 Sobrando R$ ${diferenca.toFixed(2).replace('.', ',')}`;
  }
}

async function confirmarFechamentoCaixa() {
  if (!estado.caixaAtual?._calculo) return;

  const contadoTexto = document.getElementById('input-fechar-caixa-contado').value;
  if (!contadoTexto) {
    mostrarToast('Digita quanto tem na gaveta pra confirmar.', 'erro');
    return;
  }

  const contado = parseFloat(contadoTexto.replace(',', '.')) || 0;
  const { valorEsperado } = estado.caixaAtual._calculo;
  const diferenca = round2(contado - valorEsperado);

  const { error } = await supabaseClient
    .from('caixas_turno')
    .update({
      status: 'fechado',
      fechado_por: estado.perfil.id,
      fechado_em: new Date().toISOString(),
      valor_contado: contado,
      valor_esperado: valorEsperado,
      diferenca,
    })
    .eq('id', estado.caixaAtual.id);

  if (error) {
    mostrarToast('Erro ao fechar caixa.', 'erro');
    console.error(error);
    return;
  }

  // Já dispara a impressão do fechamento automaticamente
  await supabaseClient.from('solicitacoes_impressao').insert({
    caixa_turno_id: estado.caixaAtual.id,
    tipo: 'fechamento_caixa',
    criado_por: estado.perfil.id,
  });

  mostrarToast('Caixa fechado! 🔒');
  fecharModalFecharCaixa();
  await carregarStatusCaixa();
}

// ------------------------------------------------------------
// Histórico de turnos de caixa
// ------------------------------------------------------------
async function abrirHistoricoCaixa() {
  document.getElementById('modal-historico-caixa-overlay').style.display = 'flex';
  document.getElementById('lista-historico-caixa').innerHTML = '<div class="aviso-vazio-pequeno">Carregando...</div>';

  const { data, error } = await supabaseClient
    .from('caixas_turno')
    .select('id, status, aberto_em, valor_abertura, fechado_em, valor_contado, valor_esperado, diferenca')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('aberto_em', { ascending: false })
    .limit(30);

  if (error) {
    console.error(error);
    document.getElementById('lista-historico-caixa').innerHTML = '<div class="aviso-vazio-pequeno">Erro ao carregar.</div>';
    return;
  }

  estado.historicoCaixas = data || [];
  renderHistoricoCaixa();
}

function fecharHistoricoCaixa() {
  document.getElementById('modal-historico-caixa-overlay').style.display = 'none';
}

function renderHistoricoCaixa() {
  const container = document.getElementById('lista-historico-caixa');

  if (estado.historicoCaixas.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum turno registrado ainda.</div>';
    return;
  }

  container.innerHTML = estado.historicoCaixas.map(c => {
    const dataAbertura = new Date(c.aberto_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    if (c.status === 'aberto') {
      return `
        <div class="caixa-turno-linha">
          <div class="caixa-turno-topo"><span>🔓 Em andamento</span></div>
          <div class="caixa-turno-detalhe">Aberto em ${dataAbertura} · troco inicial R$ ${Number(c.valor_abertura).toFixed(2).replace('.', ',')}</div>
        </div>
      `;
    }

    const dataFechamento = new Date(c.fechado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const dif = Number(c.diferenca);
    const classeDif = Math.abs(dif) < 0.01 ? 'bateu' : (dif < 0 ? 'faltando' : 'sobrando');
    const textoDif = Math.abs(dif) < 0.01
      ? '✅ Bateu certinho'
      : (dif < 0 ? `⚠️ Faltou R$ ${Math.abs(dif).toFixed(2).replace('.', ',')}` : `💰 Sobrou R$ ${dif.toFixed(2).replace('.', ',')}`);

    return `
      <div class="caixa-turno-linha">
        <div class="caixa-turno-topo">
          <span>${dataAbertura} → ${dataFechamento}</span>
        </div>
        <div class="caixa-turno-detalhe">
          Esperado R$ ${Number(c.valor_esperado).toFixed(2).replace('.', ',')} · Contado R$ ${Number(c.valor_contado).toFixed(2).replace('.', ',')}
        </div>
        <div class="caixa-turno-dif ${classeDif}">${textoDif}</div>
        <button class="btn-reimprimir" style="margin-top:8px;" onclick="reimprimirFechamentoCaixa('${c.id}')">🖨️ Reimprimir</button>
      </div>
    `;
  }).join('');
}

async function reimprimirFechamentoCaixa(caixaTurnoId) {
  const { error } = await supabaseClient.from('solicitacoes_impressao').insert({
    caixa_turno_id: caixaTurnoId,
    tipo: 'fechamento_caixa',
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao pedir impressão.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Reimpressão enviada! 🖨️');
}

// Imprime o resumo ANTES de fechar de verdade — pra conferir o dinheiro
// com o papel em mãos, sem travar/decidir nada no sistema ainda
async function imprimirConferenciaCaixa() {
  if (!estado.caixaAtual) return;

  const { error } = await supabaseClient.from('solicitacoes_impressao').insert({
    caixa_turno_id: estado.caixaAtual.id,
    tipo: 'conferencia_caixa',
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao pedir impressão.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Conferência enviada pra impressão! 🖨️');
}

iniciar();
