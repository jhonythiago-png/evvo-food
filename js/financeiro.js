// ============================================================
// Evvo Food — Painel Financeiro (Master)
// ============================================================

const estado = {
  perfil: null,
  periodoAtivo: 'hoje',
  dataInicio: null,
  dataFim: null,
  turnoPeriodo: null,
  despesas: [],
  sangrias: [],
  despesaEmEdicaoId: null,
};

const NOMES_CATEGORIA = {
  fornecedor: 'Fornecedor', aluguel: 'Aluguel', funcionario: 'Funcionário',
  insumo: 'Insumo', energia: 'Energia', agua: 'Água', internet: 'Internet',
  manutencao: 'Manutenção', entrega: 'Entrega (motoboy)', outro: 'Outro',
};
const NOMES_PAGAMENTO = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' };

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
// Inicialização
// ------------------------------------------------------------
async function iniciar() {
  estado.perfil = await verificarAutenticacao();
  if (!estado.perfil) return;

  if (estado.perfil.nivel_acesso !== 'master') {
    document.body.className = ''; // remove o layout de sidebar, senão a mensagem fica espremida
    document.body.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; height:100vh; text-align:center; padding:24px;">
        <div>
          <h2 style="font-family:'Bricolage Grotesque',sans-serif; margin-bottom:8px;">Acesso restrito</h2>
          <p style="color:#8A7C68; margin-bottom:16px;">Essa área é exclusiva do Master.</p>
          <a href="atendente.html" style="color:#E8A23A;">Voltar pro atendente</a>
        </div>
      </div>
    `;
    return;
  }

  injetarNavegacao(estado.perfil, 'financeiro');
  selecionarPeriodo('hoje');
  await carregarDespesas();
  await carregarSangrias();
}

// ------------------------------------------------------------
// Período
// ------------------------------------------------------------
function selecionarPeriodo(preset) {
  estado.periodoAtivo = preset;
  const hoje = new Date();
  const fim = formatarDataISO(hoje);
  let inicio;

  if (preset === 'hoje') {
    inicio = fim;
  } else if (preset === 'semana') {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 6);
    inicio = formatarDataISO(d);
  } else if (preset === 'mes') {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    inicio = formatarDataISO(d);
  } else {
    return; // 'personalizado' é tratado por atualizarPeriodoPersonalizado()
  }

  estado.dataInicio = inicio;
  estado.dataFim = fim;
  estado.turnoPeriodo = null; // limpa — só é preenchido de novo se for "hoje"

  document.querySelectorAll('.periodo-chip').forEach(el => el.classList.remove('on'));
  document.getElementById(`chip-${preset}`)?.classList.add('on');
  document.getElementById('periodo-personalizado').style.display = 'none';

  if (preset === 'hoje') {
    // Busca o período do turno ANTES de carregar os relatórios, pra já
    // usar o horário certo (não a meia-noite) na primeira carga
    buscarPeriodoTurnoMaisRecente().then(periodo => {
      estado.turnoPeriodo = periodo;
      carregarRelatorios();
    });
  } else {
    carregarRelatorios();
  }
}

function mostrarPeriodoPersonalizado() {
  document.querySelectorAll('.periodo-chip').forEach(el => el.classList.remove('on'));
  document.getElementById('chip-personalizado').classList.add('on');
  document.getElementById('periodo-personalizado').style.display = 'flex';
}

function atualizarPeriodoPersonalizado() {
  const inicio = document.getElementById('input-data-inicio').value;
  const fim = document.getElementById('input-data-fim').value;
  if (!inicio || !fim) return;
  estado.dataInicio = inicio;
  estado.dataFim = fim;
  estado.turnoPeriodo = null;
  carregarRelatorios();
}

function formatarDataISO(data) {
  return data.toISOString().slice(0, 10);
}

function formatarDataBR(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// "Hoje" segue o TURNO do caixa, não a meia-noite do calendário —
// assim, um turno que passa da meia-noite continua sendo "hoje"
// inteiro, sem cortar as vendas em 2 dias diferentes
async function buscarPeriodoTurnoMaisRecente() {
  const { data, error } = await supabaseClient
    .from('caixas_turno')
    .select('aberto_em, fechado_em')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('aberto_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null; // nunca abriu caixa ainda — cai no fallback de meia-noite

  return {
    inicio: new Date(data.aberto_em),
    fim: data.fechado_em ? new Date(data.fechado_em) : new Date(),
  };
}

// ------------------------------------------------------------
// Relatórios
// ------------------------------------------------------------
async function carregarRelatorios() {
  await Promise.all([
    carregarResumoReceitaDespesa(),
    carregarPagamentosPorForma(),
    carregarProdutosMaisVendidos(),
  ]);
}

async function carregarResumoReceitaDespesa() {
  let receitaTotal = 0;
  let qtdComandas = 0;

  if (estado.periodoAtivo === 'hoje' && estado.turnoPeriodo) {
    // "Hoje" segue o turno de verdade (não a meia-noite) — a view
    // receita_diaria agrupa por dia de calendário, então pra esse caso
    // específico consultamos os fechamentos direto, com o horário exato
    const { data: fechamentosHoje } = await supabaseClient
      .from('fechamentos')
      .select('valor_total, comandas!inner(estabelecimento_id)')
      .eq('comandas.estabelecimento_id', estado.perfil.estabelecimento_id)
      .gte('fechado_em', estado.turnoPeriodo.inicio.toISOString())
      .lte('fechado_em', estado.turnoPeriodo.fim.toISOString());

    receitaTotal = (fechamentosHoje || []).reduce((s, f) => s + Number(f.valor_total), 0);
    qtdComandas = (fechamentosHoje || []).length;
  } else {
    const { data: receitaDias } = await supabaseClient
      .from('receita_diaria')
      .select('receita_total, qtd_comandas')
      .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
      .gte('data', estado.dataInicio)
      .lte('data', estado.dataFim);

    receitaTotal = (receitaDias || []).reduce((s, r) => s + Number(r.receita_total), 0);
    qtdComandas = (receitaDias || []).reduce((s, r) => s + Number(r.qtd_comandas), 0);
  }

  // Despesas e Ajustes de caixa são lançados manualmente, sem ligação com
  // comanda nem turno — diferente da Receita, eles sempre seguem o
  // CALENDÁRIO (dia normal), nunca o horário do turno
  const { data: despesasPagas } = await supabaseClient
    .from('despesas')
    .select('valor')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .eq('status', 'pago')
    .gte('data_pagamento', estado.dataInicio)
    .lte('data_pagamento', estado.dataFim);

  const despesasTotal = (despesasPagas || []).reduce((s, d) => s + Number(d.valor), 0);

  // Ajustes de caixa (sobrou/faltou/retirada) — entram no Saldo, mas NUNCA na Receita
  const { data: ajustesPeriodo } = await supabaseClient
    .from('ajustes_caixa')
    .select('valor, criado_em')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .gte('criado_em', estado.dataInicio)
    .lte('criado_em', estado.dataFim + 'T23:59:59');

  const ajustesTotal = (ajustesPeriodo || []).reduce((s, a) => s + Number(a.valor), 0);

  const saldo = receitaTotal - despesasTotal + ajustesTotal;

  document.getElementById('card-receita').textContent = formatarMoeda(receitaTotal);
  document.getElementById('card-despesas').textContent = formatarMoeda(despesasTotal);
  document.getElementById('card-saldo').textContent = formatarMoeda(saldo);
  document.getElementById('card-saldo').className = 'card-valor ' + (saldo >= 0 ? 'positivo' : 'negativo');
  document.getElementById('card-comandas').textContent = qtdComandas;
}

async function carregarPagamentosPorForma() {
  let totais = {};

  if (estado.periodoAtivo === 'hoje' && estado.turnoPeriodo) {
    // Mesmo motivo do resumo — bypassa a view agrupada por dia. Como
    // pagamentos → fechamentos → comandas é 2 níveis de profundidade,
    // busca em 2 passos (filtro aninhado direto nem sempre funciona certo)
    const { data: fechamentosHoje } = await supabaseClient
      .from('fechamentos')
      .select('id, comandas!inner(estabelecimento_id)')
      .eq('comandas.estabelecimento_id', estado.perfil.estabelecimento_id)
      .gte('fechado_em', estado.turnoPeriodo.inicio.toISOString())
      .lte('fechado_em', estado.turnoPeriodo.fim.toISOString());

    const idsFechamentos = (fechamentosHoje || []).map(f => f.id);

    if (idsFechamentos.length > 0) {
      const { data: pagamentosHoje } = await supabaseClient
        .from('pagamentos')
        .select('forma_pagamento, valor')
        .in('fechamento_id', idsFechamentos);

      for (const p of pagamentosHoje || []) {
        totais[p.forma_pagamento] = (totais[p.forma_pagamento] || 0) + Number(p.valor);
      }
    }
  } else {
    const { data } = await supabaseClient
      .from('pagamentos_por_dia')
      .select('forma_pagamento, valor_total')
      .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
      .gte('data', estado.dataInicio)
      .lte('data', estado.dataFim);

    for (const linha of data || []) {
      totais[linha.forma_pagamento] = (totais[linha.forma_pagamento] || 0) + Number(linha.valor_total);
    }
  }

  const container = document.getElementById('lista-pagamentos-forma');
  const formas = Object.keys(totais);

  if (formas.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum pagamento no período.</div>';
    return;
  }

  const somaTotal = formas.reduce((s, f) => s + totais[f], 0);

  container.innerHTML = formas
    .sort((a, b) => totais[b] - totais[a])
    .map(forma => {
      const valor = totais[forma];
      const pct = somaTotal > 0 ? Math.round((valor / somaTotal) * 100) : 0;
      return `
        <div class="forma-linha">
          <div class="forma-topo">
            <span>${NOMES_PAGAMENTO[forma] || forma}</span>
            <span>${formatarMoeda(valor)}</span>
          </div>
          <div class="forma-barra-fundo"><div class="forma-barra" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');
}

async function carregarProdutosMaisVendidos() {
  let totais = {};

  if (estado.periodoAtivo === 'hoje' && estado.turnoPeriodo) {
    // Bypassa a view agrupada por dia — consulta os itens de pedido
    // direto, dentro do horário exato do turno
    const { data: itensHoje } = await supabaseClient
      .from('pedido_itens')
      .select('quantidade, preco_unitario_calculado, criado_em, itens_cardapio(nome), comandas!inner(estabelecimento_id)')
      .eq('comandas.estabelecimento_id', estado.perfil.estabelecimento_id)
      .neq('status', 'cancelado')
      .gte('criado_em', estado.turnoPeriodo.inicio.toISOString())
      .lte('criado_em', estado.turnoPeriodo.fim.toISOString());

    for (const item of itensHoje || []) {
      const nome = item.itens_cardapio?.nome;
      if (!nome) continue;
      if (!totais[nome]) totais[nome] = { quantidade: 0, receita: 0 };
      totais[nome].quantidade += Number(item.quantidade);
      totais[nome].receita += Number(item.preco_unitario_calculado) * Number(item.quantidade);
    }
  } else {
    const { data } = await supabaseClient
      .from('produtos_mais_vendidos')
      .select('item_nome, quantidade_total, receita_total')
      .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
      .gte('data', estado.dataInicio)
      .lte('data', estado.dataFim);

    for (const linha of data || []) {
      if (!totais[linha.item_nome]) totais[linha.item_nome] = { quantidade: 0, receita: 0 };
      totais[linha.item_nome].quantidade += Number(linha.quantidade_total);
      totais[linha.item_nome].receita += Number(linha.receita_total);
    }
  }

  const ranking = Object.entries(totais)
    .sort((a, b) => b[1].quantidade - a[1].quantidade)
    .slice(0, 10);

  const container = document.getElementById('lista-produtos-vendidos');

  if (ranking.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma venda no período.</div>';
    return;
  }

  container.innerHTML = ranking.map(([nome, dados], i) => `
    <div class="produto-linha">
      <span class="produto-posicao">${i + 1}º</span>
      <span class="produto-nome">${escapeHtml(nome)}</span>
      <span class="produto-qtd">${dados.quantidade}x</span>
      <span class="produto-receita">${formatarMoeda(dados.receita)}</span>
    </div>
  `).join('');
}

function formatarMoeda(valor) {
  return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
}

// ------------------------------------------------------------
// Despesas
// ------------------------------------------------------------
async function carregarDespesas() {
  const { data, error } = await supabaseClient
    .from('despesas')
    .select('*')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('data_vencimento', { ascending: false });

  if (error) { console.error(error); return; }

  estado.despesas = data || [];
  renderDespesas();
}

function renderDespesas() {
  const container = document.getElementById('lista-despesas');

  if (estado.despesas.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhuma despesa cadastrada.</div>';
    return;
  }

  container.innerHTML = estado.despesas.map(d => `
    <div class="despesa-linha">
      <div class="despesa-esquerda">
        <div class="despesa-descricao">${escapeHtml(d.descricao)}</div>
        <div class="despesa-detalhe">${NOMES_CATEGORIA[d.categoria]} · vence ${formatarDataBR(d.data_vencimento)}</div>
      </div>
      <div class="despesa-direita">
        <span class="despesa-valor">${formatarMoeda(d.valor)}</span>
        <span class="despesa-status ${d.status}">${d.status === 'pago' ? 'Pago' : 'Pendente'}</span>
        ${d.status === 'pendente' ? `<button class="btn-marcar-pago" onclick="marcarComoPago('${d.id}')">Marcar como pago</button>` : ''}
        <button class="btn-editar-despesa" onclick="abrirModalDespesa('${d.id}')">Editar</button>
        <button class="btn-excluir-despesa" onclick="confirmarExcluirDespesa('${d.id}')">Excluir</button>
      </div>
    </div>
  `).join('');
}

async function marcarComoPago(despesaId) {
  const { error } = await supabaseClient
    .from('despesas')
    .update({ status: 'pago', data_pagamento: formatarDataISO(new Date()) })
    .eq('id', despesaId);

  if (error) { mostrarToast('Erro ao marcar como pago.', 'erro'); return; }

  mostrarToast('Despesa marcada como paga!');
  await carregarDespesas();
  carregarRelatorios();
}

function abrirModalDespesa(despesaId) {
  const despesa = despesaId ? estado.despesas.find(d => d.id === despesaId) : null;
  estado.despesaEmEdicaoId = despesaId || null;

  document.getElementById('modal-despesa-titulo').textContent = despesa ? 'Editar despesa' : 'Nova despesa';
  document.getElementById('modal-despesa-overlay').style.display = 'flex';
  document.getElementById('input-despesa-descricao').value = despesa ? despesa.descricao : '';
  document.getElementById('input-despesa-valor').value = despesa ? String(despesa.valor).replace('.', ',') : '';
  document.getElementById('input-despesa-vencimento').value = despesa ? despesa.data_vencimento : formatarDataISO(new Date());
  document.getElementById('input-despesa-categoria').value = despesa ? despesa.categoria : 'outro';
  document.getElementById('input-despesa-ja-pago').checked = despesa ? despesa.status === 'pago' : false;
}

function fecharModalDespesa() {
  document.getElementById('modal-despesa-overlay').style.display = 'none';
  estado.despesaEmEdicaoId = null;
}

function confirmarExcluirDespesa(despesaId) {
  const despesa = estado.despesas.find(d => d.id === despesaId);
  mostrarConfirmacaoGenerica(
    `Excluir a despesa "${despesa?.descricao}" de vez? Isso não tem volta.`,
    async () => {
      const { error } = await supabaseClient.from('despesas').delete().eq('id', despesaId);
      if (error) { mostrarToast('Erro ao excluir despesa.', 'erro'); return; }
      mostrarToast('Despesa excluída.');
      await carregarDespesas();
      carregarRelatorios();
    }
  );
}

async function salvarDespesa() {
  const descricao = formatarPrimeiraLetra(document.getElementById('input-despesa-descricao').value.trim());
  const categoria = document.getElementById('input-despesa-categoria').value;
  const valorTexto = document.getElementById('input-despesa-valor').value;
  const vencimento = document.getElementById('input-despesa-vencimento').value;
  const jaPago = document.getElementById('input-despesa-ja-pago').checked;

  const valor = parseFloat(valorTexto.replace(',', '.'));

  if (!descricao || !valor || valor <= 0 || !vencimento) {
    mostrarToast('Preenche descrição, valor e vencimento.', 'erro');
    return;
  }

  const dadosDespesa = {
    descricao,
    categoria,
    valor,
    data_vencimento: vencimento,
    status: jaPago ? 'pago' : 'pendente',
    data_pagamento: jaPago ? formatarDataISO(new Date()) : null,
  };

  let error;
  if (estado.despesaEmEdicaoId) {
    ({ error } = await supabaseClient.from('despesas').update(dadosDespesa).eq('id', estado.despesaEmEdicaoId));
  } else {
    ({ error } = await supabaseClient.from('despesas').insert({
      ...dadosDespesa,
      estabelecimento_id: estado.perfil.estabelecimento_id,
      criado_por: estado.perfil.id,
    }));
  }

  if (error) {
    mostrarToast('Erro ao salvar despesa.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast(estado.despesaEmEdicaoId ? 'Despesa atualizada!' : 'Despesa cadastrada!');
  fecharModalDespesa();
  await carregarDespesas();
  carregarRelatorios();
}

// ------------------------------------------------------------
// Ajuste de caixa (sobrou/faltou dinheiro, retiradas)
// ------------------------------------------------------------
async function carregarSangrias() {
  const { data, error } = await supabaseClient
    .from('ajustes_caixa')
    .select('*')
    .eq('estabelecimento_id', estado.perfil.estabelecimento_id)
    .order('criado_em', { ascending: false })
    .limit(30);

  if (error) { console.error(error); return; }

  estado.sangrias = data || [];
  renderSangrias();
}

function renderSangrias() {
  const container = document.getElementById('lista-sangrias');

  if (!estado.sangrias || estado.sangrias.length === 0) {
    container.innerHTML = '<div class="aviso-vazio-pequeno">Nenhum ajuste registrado ainda.</div>';
    return;
  }

  container.innerHTML = estado.sangrias.map(s => {
    const data = new Date(s.criado_em);
    const dataTexto = data.toLocaleDateString('pt-BR') + ' às ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const positivo = Number(s.valor) > 0;
    const sinal = positivo ? '+ ' : '- ';
    return `
      <div class="sangria-linha">
        <div>
          <div class="sangria-descricao">${escapeHtml(s.motivo) || (positivo ? 'Adição de caixa' : 'Retirada de caixa')}</div>
          <div class="sangria-detalhe">${dataTexto}</div>
        </div>
        <span class="sangria-valor" style="color:${positivo ? 'var(--ok)' : 'var(--paprika)'}">${sinal}${formatarMoeda(Math.abs(s.valor))}</span>
      </div>
    `;
  }).join('');
}

function abrirModalSangria() {
  document.getElementById('input-sangria-tipo').value = 'retirada';
  document.getElementById('input-sangria-valor').value = '';
  document.getElementById('input-sangria-motivo').value = '';
  document.getElementById('modal-sangria-overlay').style.display = 'flex';
}

function fecharModalSangria() {
  document.getElementById('modal-sangria-overlay').style.display = 'none';
}

async function salvarSangria() {
  const tipo = document.getElementById('input-sangria-tipo').value;
  const valorTexto = document.getElementById('input-sangria-valor').value;
  const motivo = formatarPrimeiraLetra(document.getElementById('input-sangria-motivo').value.trim());
  const valorAbs = parseFloat(valorTexto.replace(',', '.'));

  if (!valorAbs || valorAbs <= 0) {
    mostrarToast('Digite um valor válido.', 'erro');
    return;
  }

  const valorComSinal = tipo === 'retirada' ? -valorAbs : valorAbs;

  const { error } = await supabaseClient.from('ajustes_caixa').insert({
    estabelecimento_id: estado.perfil.estabelecimento_id,
    valor: valorComSinal,
    motivo: motivo || null,
    criado_por: estado.perfil.id,
  });

  if (error) {
    mostrarToast('Erro ao registrar ajuste.', 'erro');
    console.error(error);
    return;
  }

  mostrarToast('Ajuste registrado!');
  fecharModalSangria();
  await carregarSangrias();
  carregarRelatorios(); // recalcula o Saldo já incluindo esse ajuste
}

iniciar();
