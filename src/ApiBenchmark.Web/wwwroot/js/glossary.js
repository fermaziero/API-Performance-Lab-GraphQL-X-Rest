import { SWEEP_LATENCIES } from './net.js';

export const GLOSSARY = [
  {
    key: 'cold',
    term: 'Cold run',
    tip: 'Primeira operação da variante, sem aquecimento: paga compilação JIT, abertura de conexão e caches frios.',
    text: 'A primeira operação de cada variante, medida sozinha e sem aquecimento. Ela paga custos que só acontecem uma vez (compilação JIT, abrir conexão, preencher caches), por isso costuma ser bem mais lenta que as seguintes. Entra como uma única amostra.',
  },
  {
    key: 'warmup',
    term: 'Warm-up (aquecimento)',
    tip: 'Operações executadas antes de medir e descartadas, para o sistema chegar ao regime estável.',
    text: 'Operações executadas antes da medição e descartadas, para o sistema chegar ao regime estável. Com rede simulada, o atraso não é aplicado no warm-up (só no cold run e no benchmark): esperar ali só gastaria tempo.',
  },
  {
    key: 'mean',
    term: 'Média',
    tip: 'Soma de todas as latências dividida pelo número de operações. Valores muito lentos puxam a média para cima.',
    text: 'Soma de todas as latências dividida pelo número de operações. Alguns valores muito lentos puxam a média para cima, por isso ela é lida junto com a mediana.',
  },
  {
    key: 'median',
    term: 'Mediana',
    tip: 'Valor do meio: metade das operações foi mais rápida e metade mais lenta. Quase não sofre com picos isolados.',
    text: 'O valor do meio ao ordenar todas as latências: metade das operações foi mais rápida e metade mais lenta. É o número principal do laboratório porque quase não é afetado por picos isolados.',
  },
  {
    key: 'p95',
    term: 'P95',
    tip: 'Percentil 95: 95% das operações foram mais rápidas que este valor; só 5% foram piores.',
    text: 'Percentil 95: 95% das operações foram mais rápidas que este valor e só 5% foram piores. Mostra o que um usuário “azarado” sente com frequência.',
  },
  {
    key: 'p99',
    term: 'P99',
    tip: 'Percentil 99: só 1 operação em 100 foi mais lenta. Mede a cauda, os piores casos.',
    text: 'Percentil 99: só 1 operação em cada 100 foi mais lenta que este valor. Mede a cauda da distribuição, os piores casos que a mediana esconde.',
  },
  {
    key: 'stddev',
    term: 'Desvio-padrão',
    tip: 'Quanto as latências variam em torno da média. Perto de zero = estável; alto = oscila muito.',
    text: 'Medida de quanto as latências variam em torno da média. Perto de zero, o comportamento é estável; alto, a latência oscila de uma operação para outra.',
  },
  {
    key: 'throughput',
    term: 'Throughput (operações por segundo)',
    tip: 'Quantas operações completas o laboratório fez por segundo nesta variante (operações medidas ÷ tempo de parede).',
    text: 'Quantas operações completas o laboratório conseguiu fazer por segundo naquela variante (operações medidas ÷ tempo de parede). Com concorrência maior que 1 aproxima a capacidade; com rede simulada inclui a espera injetada.',
  },
  {
    key: 'requests',
    term: 'Requisições HTTP por operação',
    tip: 'Quantas chamadas HTTP a tela precisa para montar o conteúdo. Cada uma paga uma ida e volta de rede.',
    text: 'Quantas chamadas HTTP são necessárias para montar o que a tela mostra. No REST orientado a recursos pode ser 1+1+N; no GraphQL costuma ser 1. Cada requisição paga uma ida e volta de rede.',
  },
  {
    key: 'bytesRecv',
    term: 'Bytes recebidos',
    tip: 'Tamanho do corpo das respostas por operação (sem cabeçalhos). Mostra o peso do payload.',
    text: 'Tamanho do corpo das respostas por operação, sem cabeçalhos. Mostra o peso do payload; com banda limitada, mais bytes significam mais tempo de transferência.',
  },
  {
    key: 'bytesSent',
    term: 'Bytes enviados',
    tip: 'Linha de requisição mais o corpo enviado, por operação (a query GraphQL conta aqui).',
    text: 'Linha de requisição mais o corpo enviado, por operação. A query GraphQL conta aqui. Costuma ser pequeno perto dos bytes recebidos.',
  },
  {
    key: 'sql',
    term: 'Consultas SQL',
    tip: 'Comandos SQL que o banco executou por operação. Uma requisição HTTP não é uma consulta SQL.',
    text: 'Quantos comandos SQL o banco executou por operação. Uma requisição HTTP não é uma consulta SQL: o formato do SQL gerado pelo ORM e o problema N+1 mudam esse número.',
  },
  {
    key: 'fields',
    term: 'Campos recebidos, usados e não usados',
    tip: 'Folhas do JSON recebidas contra as que a tela realmente usa, na operação de amostra. Os não usados são over-fetching.',
    text: 'Folhas do JSON recebidas contra as que a tela realmente usa, contadas na operação de amostra. Os campos não usados medem o over-fetching: dados trafegados à toa.',
  },
  {
    key: 'errors',
    term: 'Taxa de erro',
    tip: 'Fração de operações com status HTTP fora de 2xx, erro no corpo GraphQL ou falha de transporte.',
    text: 'Fração das operações que tiveram status HTTP fora de 2xx, erro no corpo da resposta GraphQL ou falha de transporte. Operações com erro continuam entrando na latência.',
  },
  {
    key: 'resources',
    term: 'CPU e memória alocada',
    tip: 'Do processo inteiro (cliente e servidor juntos), por operação. Não separa quem gastou.',
    text: 'CPU e bytes alocados por operação, do processo inteiro (cliente do laboratório e servidor juntos). Servem de comparação entre variantes, não como custo isolado do servidor.',
  },
  {
    key: 'net',
    term: 'Rede simulada',
    tip: 'SIMULAÇÃO: espera injetada no cliente em cada requisição (latência fixa + tempo de transferir os bytes na banda escolhida).',
    text: 'O laboratório roda em loopback, onde a rede custa quase zero. A rede simulada injeta no cliente uma espera por requisição HTTP: a latência escolhida mais o tempo de transferir os bytes na banda escolhida. É uma SIMULAÇÃO, não uma rede real. A banda é um enlace único e compartilhado: requisições simultâneas dividem a banda (esperam a vez), em vez de cada uma receber a banda inteira; a latência, ao contrário, corre em paralelo. A latência, a mediana e o throughput passam a incluir esse atraso.',
  },
  {
    key: 'simSum',
    term: 'Rede injetada (soma por operação)',
    tip: 'Soma dos atrasos simulados de todas as requisições da operação. Com requisições em paralelo (REST em paralelo), os atrasos se sobrepõem e a soma supera o acréscimo na latência.',
    text: 'Soma dos atrasos simulados de todas as requisições de uma operação. Com as requisições em sequência, a soma entra inteira na latência. Com requisições em paralelo (opção “REST em paralelo”), os atrasos delas se sobrepõem na prática: a soma passa a ser maior que o acréscimo real na latência e, por isso, não é subtraída da mediana. Concorrência maior que 1 não muda isso: ela sobrepõe operações diferentes, não as requisições de uma mesma operação. Com banda limitada, o atraso de uma requisição inclui a espera pela vez no enlace compartilhado.',
  },
  {
    key: 'real',
    term: 'Tempo real medido',
    tip: 'Mediana menos a rede injetada (só quando as requisições são sequenciais): o que o cliente e o servidor gastaram de fato.',
    text: 'A mediana menos a rede injetada, calculada só quando as requisições são sequenciais. É o que o cliente e o servidor realmente gastaram, sem a espera simulada.',
  },
  {
    key: 'sweep',
    term: 'Varredura de rede',
    tip: `Roda o cenário nas latências ${SWEEP_LATENCIES.join(', ')} ms e mostra onde a vantagem de uma variante troca de lado.`,
    text: `Executa o mesmo cenário em ${SWEEP_LATENCIES.length} latências de rede (${SWEEP_LATENCIES.join(', ')} ms por requisição) e desenha como a mediana de cada variante cresce com a rede. Onde duas linhas se cruzam, a vantagem muda de lado. Usa menos iterações por ponto que um run normal.`,
  },
];

export const TIPS = Object.fromEntries(GLOSSARY.map((g) => [g.key, g.tip]));
