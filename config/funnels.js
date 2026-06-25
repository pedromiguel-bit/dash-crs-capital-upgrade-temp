// Mapeamento fixo dos funis da Capital Upgrade na Ploomes.
// IDs descobertos e validados direto na API (api2.ploomes.com).
//
// Funil da Capital Upgrade: Leads -> Conexao -> Agendamento -> Reuniao -> Venda
//
// Sao Paulo opera num funil unico ("Funil Resultado"), onde a venda e o
// faturamento moram no proprio pipeline.
//
// Fortaleza opera em DOIS funis encadeados:
//   - "Funil SDR"    (110024809): pre-venda. Leads / Conexao / Agendamento.
//   - "Funil Closer" (110022868): fechamento. A "Reuniao realizada" e a entrada
//                    no Closer (CreateDate do deal). A "Venda" e o ganho do Closer
//                    (StatusId 2) e o faturamento real (R$) mora no Amount dos
//                    ganhos do Closer.
//
// Stages (referencia):
//   SDR    -> 110108636 Entrada | 110108640 Conexao | 110108641 Diagnostico SPIN
//             | 110108642 Apresentacao Agendada
//   Closer -> 110100651 Apresentacao | 110100652 Relacionamento
//             | 110108607 Validacao Orcamento | 110100654 Aprovacao Socio
//             | 110100655 Negocio Provavel | 110118560 Confeccionar Contrato

module.exports = {
  base: 'https://api2.ploomes.com',

  // StatusId do Deal na Ploomes: 1 = Em aberto, 2 = Ganho, 3 = Perdido
  wonStatusId: 2,

  // Fonte do faturamento (R$). O faturamento sai sempre do pipeline de
  // fechamento (Funil Resultado em SP; Funil Closer em Fortaleza), onde o
  // Deal.Amount dos ganhos tem o valor real. Enquanto for null, usa Amount;
  // se um dia o valor migrar para um campo customizado, aponte o FieldId aqui.
  revenueFieldId: null,

  regionais: {
    'sao-paulo': {
      label: 'São Paulo',
      pipelineId: 110066420, // Funil Resultado (aquisicao + fechamento)
      // Conexao = etapa Qualificacao ou adiante (carimbo de entrada).
      conexaoFieldId: 111457445, // [VD] DT de entrada em Qualificação
      // Agendamento = campo "DT de entrada em Apresentacao Agendada" preenchido
      // (carimbo [VD] de entrada na etapa, conforme orientacao do analista).
      agendamentoFieldId: 111457447, // [VD] DT de entrada em Apresentação Agendada
      // Reuniao realizada = campo de data "Data reunião realizada" preenchido
      // (a reuniao aconteceu = tem data). Mensal: data no periodo. Safra: ancora
      // no StartDate com o campo preenchido. Mesmo campo usado em Fortaleza.
      showFieldId: 111442405, // Data reunião realizada
      // Funil unico: a venda e o faturamento saem do proprio pipelineId.
      // Exclusao: desconsiderar as vendas/faturamento da Cristine Rocha.
      excludeWonOwnerIds: [110072902], // Cristine Rocha (NAO confundir com 110074388)
    },
    fortaleza: {
      label: 'Fortaleza',
      pipelineId: 110024809, // Funil SDR (leads / conexao / agendamento)
      conexaoFieldId: 111459363, // Data de entrada em diagnóstico SDR (etapa "Abertura")
      agendamentoFieldId: 111421731, // Data de entrada em apresentação sdr (etapa "Agendamento")
      // Reuniao realizada = entrada no Funil Closer (CreateDate do deal no Closer
      // = "reuniao aconteceu"), conforme estrutura do analista. Na safra, ancora
      // no StartDate (propagado do SDR).
      reuniaoFromCloserCreate: true,
      // Fechamento num funil separado: venda = ganho do Closer (StatusId 2),
      // faturamento = Amount dos ganhos do Closer.
      closerPipelineId: 110022868, // Funil Closer
    },
  },
};
