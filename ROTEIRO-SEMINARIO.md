# Roteiro do seminário: REST vs GraphQL, medido ao vivo

Duração alvo: 15 a 20 minutos. Ferramenta de apoio: o dashboard do API Performance Lab (`http://localhost:5080`). Detalhes técnicos e limitações estão no [README](README.md) e em [`docs/CONTRATO.md`](docs/CONTRATO.md).

**Princípio do roteiro.** Os números do dashboard são medidos na hora e mudam a cada execução e a cada máquina. Este documento descreve **tendências e mecanismos**; os valores que aparecem como "exemplo de uma execução" vêm de rodadas de verificação em Windows e servem só de ilustração. Não os apresente como resultados do laboratório: apresente o que a tela mostrar. Os exemplos vêm de duas origens: a **rodada com rede** (a mais recente: rede simulada e base de 100.000 produtos) e a **rodada anterior** (feita antes da rede simulada, com a base de 500 produtos, só em loopback); o [Anexo](#anexo-exemplo-de-uma-execução-somente-ilustração) separa as duas.

**O fio condutor.** Em loopback a rede custa zero, então REST e GraphQL ficam separados por décimos de milissegundo a poucos milissegundos e quase todo argumento a favor de um ou de outro "não aparece". O clímax da apresentação é **ligar a rede simulada**: de repente cada ida e volta custa a latência inteira e cada byte custa na banda, e o número de requisições e de bytes que parecia detalhe passa a ser o que decide o tempo. A lição que a demonstração entrega é **quantas vezes se atravessa a rede e quantos bytes viajam**, não qual tecnologia é melhor.

**Vocabulário.** Usado como no capítulo 8 do livro-texto (Tecnologias e Protocolos para Arquiteturas de Serviços): comunicação síncrona de requisição e resposta, REST como estilo arquitetural (recursos identificados por URI, endereçabilidade, interface uniforme, ausência de estado), GraphQL como linguagem de consulta e mecanismo de execução com schema tipado, over-fetching e under-fetching.

## Cronograma

| Início | Bloco | Versão 20 min | Versão 15 min |
|---|---|---|---|
| 0:00 | 1. Abertura e pergunta-problema | 1:30 | 1:00 |
| 1:30 | 2. REST e GraphQL em 3 minutos | 2:30 | 2:00 |
| 4:00 | 3. Arquitetura, comparação justa e a rede simulada | 1:30 | 1:00 |
| 5:30 | 4. Apresentando a tela | 1:00 | 0:30 |
| 6:30 | 5.1 Demonstração: consulta simples (loopback) | 1:00 | 0:30 |
| 7:30 | 5.2 Demonstração: over-fetching, e a banda de 5 Mbps | 2:30 | 1:30 |
| 10:00 | 5.3 Demonstração: relacionamentos, rede de 50 ms e varredura (clímax) | 4:30 | 3:30 |
| 14:30 | 5.4 Demonstração: N+1 | 1:30 | 1:00 |
| 16:00 | 5.5 Opcional: volume como teste de estresse | 1:00 | cortado |
| 17:00 | 7. Fechamento: a tese e a tabela de decisão | 2:00 | 1:30 |
| 19:00 | Margem para atrasos | 1:00 | 2:30 |

Os horários nos títulos dos blocos abaixo são os da versão de 20 minutos. Se as perguntas da banca entrarem no tempo total, use a versão de 15 minutos. O bloco 6 (N+1 em PostgreSQL) é um opcional fora do cronograma: só entra no lugar do 5.5, e só se foi ensaiado.

**Ponto de corte se estiver atrasado, nesta ordem:** pule o 5.5 (volume); depois o cenário `simple` (conte em uma frase); depois o "REST em paralelo" do 5.3; depois conte o 5.4 só pelas contagens (51, 2 e 1 consultas SQL). **Nunca corte a varredura de rede do 5.3: é o clímax.**

## Receita da demonstração (configuração de cada passo)

Dois perfis de configuração, para não ficar mexendo na tela:

- **Perfil A (loopback):** 1.000 iterações, warm-up 50, concorrência 1, rede desligada (0 ms, Sem limite).
- **Perfil B (com rede):** 30 iterações, warm-up 10, concorrência 1. Com a rede ligada cada operação dura de dezenas a centenas de ms; com 1.000 iterações o `nested` a 50 ms levaria mais de 7 minutos. A varredura já usa no máximo 30 iterações e 10 de warm-up por etapa.

| Passo | Cenário | Rede simulada | Perfil | Duração aproximada do run |
|---|---|---|---|---|
| 5.1 | Consulta simples | desligada | A | alguns segundos |
| 5.2a | Over-fetching em lista | desligada | A | alguns segundos |
| 5.2b | Over-fetching em lista | banda 5 Mbps, latência 0 | B | (68,7 + 8,5) ms × 30, cerca de 2 s |
| 5.3a | Relacionamentos | desligada | B | menos de 1 s (mais o cold) |
| 5.3b | Relacionamentos | 50 ms, banda Sem limite | B | (359 + 51,6 + 52) ms × 30, cerca de 14 s |
| 5.3c | Relacionamentos + REST em paralelo | 50 ms | B | (154 + 51,6 + 52) ms × 30, cerca de 8 s |
| 5.3d | Relacionamentos, **Varredura de rede** | 0, 20, 50 e 100 ms (automático), banda Sem limite, REST em paralelo desligado | automático (até 30 / 10 por etapa) | cerca de 1 min (medido: 54 s, com etapas de 3,7, 6,6, 15 e 29 s) |
| 5.4 | N+1 | desligada | A | alguns segundos |
| 5.5 | Carga em volume | desligada | padrão do cenário | meta de até cerca de 45 s |

As durações são calculadas a partir das medianas do exemplo (iterações × soma das medianas das variantes) e a da varredura assume o BFF próximo do GraphQL; **cronometre cada uma no ensaio**. O warm-up não espera rede, então não pesa.

## Glossário curto (para ter na ponta da língua)

| Termo | Em uma frase |
|---|---|
| Cold run | A primeira operação de cada variante, medida sozinha e sem aquecimento: paga JIT, conexão e caches frios, por isso é bem mais lenta. É uma amostra só |
| Warm-up | Operações executadas antes de medir e descartadas, para o sistema chegar ao regime estável. A rede simulada não vale no warm-up |
| Média | Soma das latências dividida pelo número de operações; alguns valores muito lentos puxam a média para cima |
| Mediana | O valor do meio: metade das operações foi mais rápida e metade mais lenta. É o número principal do laboratório |
| P95 | 95% das operações foram mais rápidas que este valor; só 5% foram piores |
| P99 | Só 1 operação em 100 foi mais lenta. Mede a cauda, os piores casos |
| Desvio-padrão | Quanto as latências variam em torno da média. Perto de zero é estável |
| Throughput | Operações completas por segundo (operações medidas ÷ tempo de parede). Com rede simulada inclui a espera |
| Requisições por operação | Quantas chamadas HTTP a tela precisa para montar o conteúdo. Cada uma paga uma ida e volta de rede |
| Bytes (recebidos e enviados) | Tamanho do corpo das respostas e da requisição (linha e corpo) por operação. Com banda limitada, mais bytes é mais tempo |
| SQL por operação | Quantos comandos SQL o banco executou. Uma requisição HTTP não é uma consulta SQL |
| Campos recebidos, usados e não usados | Folhas do JSON recebidas contra as que a tela usa; os não usados medem o over-fetching |
| Rede simulada | SIMULAÇÃO: uma espera injetada no cliente em cada requisição, igual à latência escolhida mais o tempo de transferir os bytes na banda escolhida |
| Banda | Quantos megabits por segundo a "rede" transporta. O tempo de transferir é bytes × 8 ÷ banda; 100 KB a 5 Mbps custam cerca de 164 ms |

**Por que mediana e percentis, e não a média.** A média se deixa enganar por poucos valores extremos, e latência de sistema tem exatamente isso (um GC, um pico de CPU, o cold run). Exemplo hipotético (não é medição): 98 operações de 1 ms e 2 de 1.000 ms dão média de cerca de 21 ms, valor que nenhuma operação teve; a mediana é 1 ms (o caso típico) e o P99 é 1.000 ms (a cauda). A mediana diz o que o usuário típico sente; P95 e P99 dizem o que o usuário azarado sente; a média mistura as duas coisas e não descreve nenhuma. Por isso o laboratório destaca a mediana e mostra P95 e P99.

## Bloco 1. Abertura e pergunta-problema (0:00 a 1:30)

**Mostrar:** dashboard aberto no primeiro cenário (ou um slide com a pergunta).

**Dizer:**

- "Uma tela precisa mostrar o nome de um cliente, a data e o total de cada pedido dele e o nome e o preço de cada produto. Com REST orientado a recursos, para o cliente 15 do nosso banco são 7 requisições. Com GraphQL, é 1 query. Qual é melhor?"
- "Se eu perguntar 'GraphQL é mais rápido que REST?', a resposta honesta é 'depende'. Hoje vamos medir de quê."
- Anunciar o formato: "Vou mostrar situações reais de acesso a dados. Em cada uma, a mesma base de dados, as duas APIs, e números medidos ao vivo, não slides. E vou ligar uma rede simulada, porque no meu notebook a rede custa zero e isso esconde quase tudo que importa."
- As perguntas que organizam a demonstração:
  1. Pedir "tudo igual" em GraphQL custa mais? (consulta simples)
  2. Pedir só o que a tela usa economiza o quê, e quanto isso vale numa rede lenta? (over-fetching e banda)
  3. Uma query no lugar de várias requisições resolve, e quanto vale numa rede com latência? (relacionamentos e varredura de rede)
  4. O que acontece por trás de uma única requisição? (N+1)
  5. E se pedirmos 100 mil registros de uma vez? (volume, se der tempo)

**Interação (opcional, 20 s):** peça um palpite por levantar de mão ("quem acha que GraphQL é mais rápido? REST? depende?"). Retome no fechamento.

## Bloco 2. REST e GraphQL em 3 minutos (1:30 a 4:00)

### REST (1:30 a 2:30)

- Estilo arquitetural, não protocolo (cap. 8, §8.4): dados modelados como **recursos**, cada um com uma **URI**; três princípios: endereçabilidade, interface uniforme (verbos HTTP) e ausência de estado.
- Cada rota devolve a representação do recurso: `GET /api/products/150`, `GET /api/customers/15/orders`.
- Vantagens: simples, previsível, cacheável por URL com os mecanismos do próprio HTTP.
- Contrapartida: **o servidor decide o formato** da resposta.

### GraphQL (2:30 a 3:20)

- Linguagem de consulta e mecanismo de execução (cap. 8, §8.5). Um único endpoint (`POST /graphql`), **schema tipado** como contrato, e o **cliente declara os campos** que quer.
- Três operações no livro (query, mutation, subscription); neste laboratório só há **leitura**, ou seja, queries.
- Escrever no quadro: `{ product(id: 150) { name price sku } }`.
- Lembrar a armadilha do capítulo: GraphQL **não é um banco de dados**. É uma camada de comunicação sobre HTTP; atrás dela ainda existe um banco. Guarde essa frase para o bloco do N+1.

### Os três problemas (3:20 a 4:00)

- **Over-fetching:** a resposta traz mais do que a tela usa (mais bytes).
- **Under-fetching:** a tela precisa de dados de vários recursos e faz várias requisições (1+1+N). Cada requisição é uma **ida e volta** de rede. Desenhar a comparação do capítulo: três chamadas REST contra uma consulta GraphQL.
- **N+1:** problema do servidor, não do protocolo. Lista de 50 pedidos com o cliente de cada um: 1 SELECT para os pedidos e mais 50 SELECTs, um por cliente.
- Gancho: "Cada um desses problemas virou um cenário que vamos medir. Os dois primeiros custam rede; o terceiro custa banco."

## Bloco 3. Arquitetura, comparação justa e a rede simulada (4:00 a 5:30)

**Mostrar:** o diagrama do [README](README.md#3-arquitetura) (abra o arquivo no GitHub ou use um slide).

**Dizer (percorrendo o diagrama):** dashboard no navegador inicia o run, o motor de benchmark chama o próprio servidor por HTTP, o servidor expõe REST e GraphQL, e os dois usam o mesmo EF Core e o mesmo banco, com 100 mil produtos.

**Por que a comparação é justa (seis pontos):**

1. **Mesma base e mesmo seed:** os dois lados leem exatamente os mesmos dados.
2. **HTTP real, não chamada de método:** o motor faz requisições por loopback, então roteamento, serialização e parse contam para os dois.
3. **Mesma máquina, mesmo processo, mesmo cliente de medição.**
4. **Protocolo de medição:** cold run à parte, warm-up descartado, blocos intercalados com ordem alternada (ninguém roda sempre por último), mediana e percentis P95 e P99 em vez de só média.
5. **Nada fixo na tela:** o SQL é contado por um interceptor do EF Core, os bytes são contados no corpo da resposta, os campos são contados no JSON.
6. **A mesma rede para os dois lados:** a latência e a banda simuladas valem igualmente para REST e GraphQL. O que muda entre as variantes é só quantas requisições e quantos bytes cada uma usa.

**A rede simulada em 40 segundos (diga isto):**

- "O laboratório roda em loopback: cliente e servidor na mesma máquina, onde uma ida e volta custa microssegundos. Isso esconde exatamente o que mais pesa numa rede real."
- "Para mostrar esse custo, o motor injeta uma espera em cada requisição: uma latência fixa mais o tempo de transferir os bytes na banda escolhida. Bytes vezes 8, dividido pela banda."
- "É uma **simulação**: o tráfego continua local e a espera é injetada no cliente, depois que a resposta chega. Vale no cold run e no benchmark, não no warm-up, e é precisa a menos de 1 ms. Não é uma rede real: não tem perda de pacote, variação de atraso nem handshake. Mais adiante eu volto ao que isso significa."

**Ressalvas (diga antes que a banca diga):**

- Sem a rede simulada é **loopback**: não há rede de verdade, e isso subestima o custo de várias requisições e de bytes extras.
- A rede simulada é um **modelo simples** (atraso fixo por requisição mais bytes ÷ banda); os valores de 20, 50 e 100 ms e de 5 Mbps são escolhas didáticas, não medições de uma rede específica.
- As **implementações diferem** além do protocolo: o REST monta DTOs à mão; o GraphQL usa projeção automática. Compara-se REST e GraphQL *implementados nesta pilha*.
- Cliente e servidor estão no **mesmo processo**: CPU e memória são do processo inteiro (e, com a rede ligada, não são comparáveis com as de runs sem rede).

**Se o tempo apertar neste bloco:** deixe dos seis pontos de justiça só o 1, o 4 e o 6.

**Frase-chave:** "Confiem mais nas **contagens** (requisições, consultas SQL, bytes, campos), que são determinísticas, do que nos **tempos**, que variam com a máquina. Os tempos mostram ordem de grandeza."

## Bloco 4. Apresentando a tela (5:30 a 6:30)

Percorra de cima para baixo, em ritmo de tour:

- **Faixa de ambiente:** versão do .NET, sistema, núcleos e contagens reais do banco (100.000 produtos; e, no modo PostgreSQL, qual banco está em uso).
- **01 Cenário:** seis cartões, cada um com "A tela precisa". Clicar mostra as requisições de cada variante, com o texto exato (GET ou query GraphQL).
- **02 Configuração:** iterações, warm-up e concorrência, e o grupo **Rede simulada** (selo SIMULAÇÃO): chips de latência (0, 20, 50, 100 ms) e de banda (Sem limite, 100, 20, 5 Mbps), com uma linha-resumo que diz o que será injetado. Os botões: EXECUTAR BENCHMARK, Executar todos os cenários e **Varredura de rede**.
- **Barra de progresso:** passos Cold run, Warm-up, Benchmark, Concluído.
- **03 Varredura de rede** (aparece depois de uma varredura) e **04 a 08:** cartões por variante (mediana em destaque, com o grupo "Rede simulada"), comparativo (melhor valor marcado, razão ×, "empate técnico" quando a diferença é menor que 3% ou que a dispersão medida no próprio run), gráficos, trace das requisições em forma de waterfall (barra sólida para o tempo real e hachurada para a rede simulada) e um texto de leitura gerado a partir dos números.
- **09 Histórico, 10 Matriz-resumo e 11 Glossário** (recolhível, com os verbetes de cada métrica).
- Avise: "Não vou tocar na tela durante os runs. Qualquer requisição extra entra nas métricas."

## Bloco 5. Demonstração ao vivo, cenário a cenário

Para cada cenário: peça um palpite rápido, clique, e use o tempo de execução para falar do que está acontecendo (cold, warm-up, blocos, e a espera da rede quando ligada). A primeira execução de cada variante depois que o servidor subiu leva pelo menos 1 s a mais por variante (warm-up estendido). Siga a [receita](#receita-da-demonstração-configuração-de-cada-passo) de configuração.

### 5.1 Consulta simples, em loopback (6:30 a 7:30)

- **Clique:** cenário "Consulta simples (mesmo payload)", rede desligada, e EXECUTAR BENCHMARK. Se o servidor acabou de subir, aproveite: é a primeira execução, então o **cold run** aparece com a marca "1ª desde o start".
- **Aponte:**
  - mediana de cada variante;
  - "Cold run" bem acima da mediana (JIT, conexões, caches: custo da primeira vez, não do estilo de API);
  - "Bytes recebidos" quase iguais e "Bytes enviados" maiores no GraphQL (a query vai no corpo de um POST);
  - "Consultas SQL" iguais.
- **Tendência esperada:** REST com latência menor ou igual; GraphQL com um **custo fixo de décimos de milissegundo**; payload e SQL equivalentes.
- **Por quê:** o GraphQL faz trabalho extra a cada requisição (parse do documento, validação contra o schema, planejamento e execução dos resolvers, montagem da resposta). O REST vai direto ao handler. O SQL é o mesmo, então a diferença é o custo do mecanismo de execução.
- **Exemplo de uma execução (rodada anterior, 300 iterações, warm-up 50):** REST cerca de 0,33 ms e GraphQL cerca de 0,52 ms; 834 B contra 855 B recebidos.
- **Frase:** "É o ponto fraco que o livro atribui ao GraphQL: mais lento em consultas simples. O custo é de décimos de milissegundo e é o preço da flexibilidade. Guardem esse número: vamos ver o que ele vale quando a rede entra."
- **Se der empate técnico (diferença menor que 3% ou que a dispersão medida):** diga isso: sem diferença detectável aqui. Não force uma história.
- **Gancho:** "Então por que alguém pagaria esse custo? Próximo cenário."

### 5.2 Over-fetching, e a banda de 5 Mbps (7:30 a 10:00)

**Parte 1, em loopback (cerca de 1 min).**

- **Clique:** cenário "Over-fetching em lista" (50 produtos), perfil A, rede desligada. Execute. (Se sobrar tempo, mostre antes o "Over-fetching" de 1 produto: mesma lógica em pequeno.)
- **Aponte:**
  - em "A tela precisa": só nome, preço e SKU de cada um dos 50 produtos;
  - nos cartões, "Bytes recebidos": **41.883 B** no REST contra **4.301 B** no GraphQL, cerca de 10 vezes menos (com 1 produto: 834 B contra 112 B, cerca de 7 vezes);
  - a barra de "Campos JSON" (recebidos, usados, não usados): o REST usa 150 de 750 campos, o GraphQL usa 150 de 150;
  - em "O que trafegou", a resposta de amostra do REST (descrição longa, categoria e fornecedor) ao lado da do GraphQL (três campos).
- **O tempo, em loopback, empata ou quase:** os dois lados ficam na casa de décimos de milissegundo (rodada anterior: 0,79 ms o REST e 0,55 ms o GraphQL; com 1 produto o REST chega a ficar à frente ou empatado). Bytes quase não custam em loopback.
- **Franqueza:** "Em loopback eu medi o desperdício de bytes, mas não o que ele custaria numa rede de verdade. Vamos ligar a rede."

**Parte 2, banda de 5 Mbps (cerca de 1 min).**

- **Clique:** troque para o perfil B (30 iterações, warm-up 10) e ligue a banda **5 Mbps**, com latência 0. Leia a linha-resumo da tela: "100 KB trafegados custam ≈ 164 ms". Execute.
- **Aponte:** o tempo agora acompanha os bytes. Exemplo de uma execução (rodada com rede): REST **68,7 ms** (41.883 B) contra GraphQL **8,5 ms** (4.301 B). A razão de tempo (cerca de 8 vezes) fica perto da razão de bytes (cerca de 10 vezes).
- **A conta na lousa:** 41.919 B (resposta mais requisição) × 8 ÷ 5 Mbps ≈ 67 ms; 4.378 B ≈ 7 ms. O resto, cerca de 1,5 ms nos dois, é o tempo real (cliente e servidor em loopback).
- **Por quê:** a rede simulada cobra cada byte. Em loopback, transferir 41 KB custava quase nada; a 5 Mbps custa dezenas de milissegundos. O ganho do GraphQL é pedir só o que a tela usa, e esse ganho depende de a banda ser o gargalo: rede móvel, plano de dados, listas grandes, muitos clientes simultâneos.
- **Antes de seguir:** volte a banda para **Sem limite** (senão ela entra nos números do 5.3).
- **Gancho:** "Bytes custam na banda. Agora o outro custo da rede: cada ida e volta custa a latência inteira."

### 5.3 Relacionamentos, rede de 50 ms e varredura: o clímax (10:00 a 14:30)

**Passo a: em loopback (cerca de 1 min).**

- **Clique:** cenário "Relacionamentos", perfil B, rede desligada. **Antes de executar** (15 s), mostre as três variantes: `rest` (três tipos de GET, o último repetido N vezes), `rest-bff` (um GET) e `graphql` (uma query aninhada). Execute.
- **Aponte:**
  - "Requisições HTTP": 7 (REST, com o seed padrão), 1 (BFF) e 1 (GraphQL);
  - "Consultas SQL": 7 (REST), 1 (BFF) e **3 (GraphQL)**, não 1 (explicação na [pergunta 11 da banca](#perguntas-prováveis-da-banca)); "Bytes recebidos"; e "Campos não usados": o REST recebe campos que a tela não usa, BFF e GraphQL, nenhum;
  - os tempos, em loopback: exemplo de uma execução (rodada com rede) REST **3,6 ms**, BFF **0,7 ms**, GraphQL **1,1 ms**. A diferença é de poucos ms.
- **Frase:** "No meu notebook, sete requisições custam 3,6 ms. Parece pouco. Agora imaginem o servidor do outro lado de uma rede."

**Passo b: 50 ms por requisição (cerca de 1 min).**

- **Clique:** ligue a latência de **50 ms** (chip), banda Sem limite, e execute de novo. Enquanto roda (cerca de 14 s), fale: "agora cada requisição espera 50 ms antes de ser considerada concluída."
- **Aponte (o clímax numérico):** exemplo de uma execução (rodada com rede): REST **359 ms**, BFF **51,6 ms**, GraphQL **52,0 ms**. "As 7 idas e voltas do REST viram cerca de 360 ms; a ida e volta única do GraphQL, cerca de 52 ms."
  - No cartão do REST, o grupo "Rede simulada" mostra "Rede simulada (soma injetada)" de cerca de 350 ms, quase tudo dos 359 ms, e o "Tempo real medido" (a mediana menos a rede) de poucos ms. Pelo waterfall: uma **escada de 7 blocos hachurados** e o tile "rede paga 7× · 350 ms simulados".
  - **O BFF empata com o GraphQL** (51,6 contra 52,0 ms: empate técnico). Diga explicitamente: "O endpoint sob medida e o GraphQL pagam a mesma coisa: uma ida e volta. A lição não é 'GraphQL ganha'; é **o número de idas e voltas**."
- **Por quê:** a latência é cobrada por requisição e, no modo sequencial, cada uma das 7 requisições do REST espera a anterior terminar, então 7 × 50 ms. Lembra do custo fixo de décimos de ms do GraphQL no 5.1? Diante de 50 ms por requisição ele desaparece.

**Passo c: e se o REST fizer em paralelo? (cerca de 30 s; opcional)**

- **Clique:** ligue "REST em paralelo" e execute. Exemplo de uma execução (rodada com rede): REST **154 ms**.
- **Aponte:** a latência cai de 359 para cerca de 154 ms, mas fica 3 vezes acima da do GraphQL: são 3 "ondas" de espera em cascata (cliente, pedidos e os 5 itens juntos, 3 × 50 ms mais o tempo real). A soma injetada continua cerca de 350 ms; a tela avisa que os atrasos se sobrepõem e não a subtrai da mediana. Requisições, SQL e bytes não mudam: **paralelismo esconde latência, não elimina trabalho**.
- **Desligue** o "REST em paralelo" antes da varredura.

**Passo d: Varredura de rede (cerca de 1 min de execução)**

- **Confira antes:** banda Sem limite, "REST em paralelo" desligado, cenário "Relacionamentos". Clique em **Varredura de rede**. O laboratório roda o cenário em 0, 20, 50 e 100 ms, uma etapa por vez, com até 30 iterações e 10 de warm-up por etapa. Acompanhe a barra "etapa k de 4".
- **Enquanto roda (fale ~1 min):** "Cada ponto do gráfico é um run próprio nessa latência. Vou apostar: a linha do REST vai subir muito mais que a do GraphQL. Quanto mais? Se cada requisição paga a latência, o REST deve subir 7 vezes mais, porque faz 7 requisições." (Não toque na tela.)
- **Aponte no gráfico "Mediana × latência de rede":** exemplo de uma execução (rodada com rede): REST **7,8 → 158 → 369 → 719 ms**; GraphQL **2,6 → 24 → 54 → 105 ms** (0, 20, 50 e 100 ms).
  - **As retas se abrem**, como um leque. A inclinação, na leitura gerada pela tela: cerca de **+71 ms a cada +10 ms** de latência para o REST (7 requisições) contra cerca de **+10 ms** para o GraphQL (1 requisição), uma inclinação cerca de **7 vezes maior**. O gráfico mede o que a conta já previa: a inclinação é o número de requisições.
  - BFF e GraphQL ficam paralelos entre si: mesma inclinação (1 requisição cada), com diferença de décimos de ms que vira empate técnico.
  - **Não há cruzamento** (o texto da tela diz "Nenhum cruzamento entre 0 e 100 ms de rede"): a variante de 1 requisição já ganha com rede zero e só se afasta. Não procure um ponto de virada que não existe (veja a [pergunta 2 da banca](#perguntas-prováveis-da-banca)).
  - O ponto de 0 ms da varredura usa poucas iterações e pode diferir do run em loopback do passo a (7,8 ms contra 3,6 ms para o REST): a varredura mostra o formato da curva, não o valor exato de cada ponto.
- **Frase de fechamento do bloco:** "O que separa as variantes não é a tecnologia: é quantas vezes cada uma atravessa a rede. Cada ida e volta custa a latência inteira; cada byte custa na banda."
- **Gancho:** "Mas o que acontece depois que a requisição chega ao servidor?"

### 5.4 N+1 (14:30 a 16:00)

- **Clique:** volte ao perfil A (1.000 iterações, warm-up 50), rede desligada. Cenário "N+1 no servidor GraphQL". Mostre que as três queries GraphQL são quase idênticas e mudam o campo do cliente: `customerNaive` e `customerBatched` (sobre `recentOrders`) e `customer` (sobre `orders`, com projeção). Execute.
- **Aponte:**
  - "Requisições HTTP": **1 em todas**: a rede simulada não distinguiria as quatro variantes;
  - "Consultas SQL": 1, 51, 2 e 1, para a mesma resposta na tela;
  - a ordem das medianas segue o número de consultas SQL;
  - o gráfico "Requisições HTTP e consultas SQL por operação".
- **Tendência esperada:** a variante ingênua é a mais lenta com folga, o DataLoader fica no meio e a projeção fica próxima do REST.
- **Por quê:**
  - Em GraphQL o resolver de um campo roda **uma vez por item** da lista. Sem estratégia, cada pedido dispara seu SELECT: 1 + 50 consultas.
  - O **DataLoader** junta as chaves pedidas no mesmo ciclo de execução e faz um único `WHERE id IN (...)`: 2 consultas.
  - A **projeção** traduz a árvore da query em um `JOIN` único: 1 consulta. O endpoint REST de lista já faz esse JOIN.
- **Ponto-chave:** "GraphQL reduz idas e voltas **HTTP**; não reduz idas ao **banco**." A rede simulada atua entre o cliente e o servidor; o N+1 acontece entre o servidor e o banco, que a rede simulada não toca. Com a rede ligada, as quatro variantes pagam a mesma latência (1 requisição cada) e a diferença do N+1 tende a ficar diluída no meio da rede, mas continua lá. Lembre a frase do capítulo: GraphQL não é banco de dados. N+1 também ocorre em REST (um endpoint que faz uma consulta por item), mas a execução por campo do GraphQL torna a armadilha mais fácil de cair.
- **O banco in-process disfarça:** com SQLite dentro do processo cada consulta custa microssegundos, e ainda assim o N+1 fica várias vezes mais lento. Quando o banco está na rede, a conta piora (bloco 6).
- **Exemplo de uma execução (rodada anterior, 300 iterações, warm-up 50):** REST 0,83 ms; GraphQL ingênuo 8,81 ms (51 SQL); DataLoader 2,04 ms (2 SQL); projeção 1,06 ms (1 SQL). Bytes recebidos: 11.520 B no REST (200 de 500 campos usados) e cerca de 5 KB no GraphQL (200 de 200).
- **Gancho:** "Isso é com o banco dentro do processo. E se o banco não estivesse?" (bloco 6), "E o que acontece no extremo, pedindo tudo?" (5.5) ou "Vamos fechar." (bloco 7)

### 5.5 Opcional: volume como teste de estresse (16:00 a 17:00)

Use só se estiver no horário e se houver memória livre. É um **teste de estresse deliberado**: ninguém serve 100 mil registros numa resposta; em produção os dois lados paginariam.

- **Clique:** cenário "Carga em volume (100.000 produtos)", rede **desligada**. A tela avisa "Cenário pesado: sugerido 3 iterações, máximo 100; concorrência máxima 2": deixe os padrões do cenário (3 iterações, warm-up 0) e a concorrência em 1. Execute. O run leva cerca de 45 s (exemplo medido: 42 a 45 s; cronometre no ensaio); fale enquanto roda. **Não combine este cenário com banda limitada ao vivo.**
- **Aponte:**
  - "Bytes recebidos": REST **83.550.652 B** (cerca de 80 MB), GraphQL com 3 campos **8.361.921 B** (cerca de 8 MB, 10 vezes menos) e GraphQL com todos os campos **83.550.674 B**: pedindo tudo, o GraphQL entrega o mesmo conteúdo do REST e tem o mesmo peso (os 22 B a mais são o envelope `data` da resposta);
  - o tempo em segundos, não em milissegundos. Exemplo medido (SQLite, build Release, máquina com outros programas abertos, só ordem de grandeza): REST 3,5 a 3,7 s, GraphQL com 3 campos cerca de 1,05 s, GraphQL completo cerca de 6,0 s por consulta;
  - a memória: o processo inteiro (servidor e motor) chegou a 1,0 a 1,4 GB com um cliente por vez (o servidor sozinho, perto de 0,85 GB) e o servidor a cerca de 3,5 GB com 8 clientes completos em paralelo, o motivo de o cenário limitar a concorrência a 2.
- **Lições:** (1) o custo cresce com os bytes: numa rede de 100 Mbps, 83.550.652 B levariam cerca de 6,7 s só de transferência e 8.361.921 B cerca de 0,67 s (conta pela fórmula da rede simulada, **não é medição**); (2) GraphQL não protege o servidor: sem paginação e sem limite de custo, uma única query pode pedir a base inteira; (3) pedir só os campos usados continua valendo em escala.
- **Frase:** "É a mesma lição do over-fetching, no extremo. E é por isso que produção pagina, limita o custo da query e mede a memória."

## Bloco 6. Opcional: N+1 em PostgreSQL (fora do cronograma; no lugar do 5.5)

Use só se estiver no horário **e** a preparação abaixo tiver sido ensaiada. Rode **um** cenário: `nplus1`. Não confunda: a rede simulada atua entre o cliente e o servidor; o PostgreSQL atua entre o servidor e o banco.

**Preparação (antes da apresentação, não ao vivo):**

1. `docker compose up -d` e `docker compose ps` até aparecer `healthy`.
2. Subir o servidor com `dotnet run -c Release --project src/ApiBenchmark.Web -- --Database:Provider=postgres` **uma vez** para semear o banco (inclusive os 100.000 produtos, o que leva alguns segundos a mais na primeira vez) e conferir a faixa de ambiente.
3. Decidir como trocar durante a fala:
   - **Opção A (mais simples):** parar o servidor SQLite (`Ctrl+C`), subir o de PostgreSQL e recarregar a página. Leva alguns segundos; o histórico em memória do servidor anterior se perde.
   - **Opção B:** deixar um segundo servidor pronto em outra porta, adicionando `--urls http://localhost:5081` ao comando do PostgreSQL. Foi exercitada: dois servidores no ar ao mesmo tempo (SQLite em 5080 e PostgreSQL em 5081), cada um com o seu painel e o motor chamando o próprio servidor. Com dois servidores no ar, só use o painel de um por vez.

**Ao vivo:**

- **Mostre** a faixa de ambiente indicando `postgres` e diga o que mudou: o banco agora é um processo separado, falado por TCP.
- **Execute** `nplus1` com a mesma configuração.
- **Aponte:** as **contagens de SQL são idênticas** (1, 51, 2 e 1); o que muda é o tempo de cada consulta. Exemplo (rodada anterior, 300 iterações): REST 2,4 ms, ingênuo 13,3 ms, DataLoader 4,7 ms e projeção 3,1 ms, contra 0,8, 8,8, 2,0 e 1,1 ms no SQLite da mesma máquina.
- **Tendência esperada (confirme ao vivo):** a diferença em milissegundos entre a variante ingênua e as demais tende a aumentar em relação ao SQLite (a razão entre elas pode até diminuir, porque todas passam a ter um piso de latência maior), porque cada uma das 51 consultas agora paga uma ida e volta por TCP, enquanto REST e projeção pagam uma vez e o DataLoader, duas.
- **Lição de engenharia:** o custo do N+1 é (número de consultas) × (custo de uma ida e volta ao banco). Com banco in-process o segundo fator é quase zero e o erro passa despercebido em desenvolvimento; com banco em rede, aparece. Ambiente de desenvolvimento com SQLite pode esconder um problema que só surge em produção.
- **Cuidado ao falar de números:** não compare os tempos de PostgreSQL com os de SQLite como se fossem a mesma bateria (Docker no Windows acrescenta camadas, o motor do banco é outro). Compare a **proporção entre variantes dentro do mesmo banco**.
- **Se rodar o `nested` em PostgreSQL:** a divisão em 3 consultas (`AsSplitQuery`) custa 3 idas e voltas ao banco; num exemplo (rodada anterior, 300 iterações), REST 13,1 ms, BFF 2,6 ms e GraphQL 5,7 ms. A tendência é o GraphQL ficar entre o BFF e o REST de 7 requisições, mas confirme ao vivo e só compare dentro do mesmo banco.
- **Se algo falhar:** volte ao SQLite e siga ([plano B](#plano-b)).

## Bloco 7. Fechamento: a tese e a tabela de decisão (17:00 a 19:00)

**Voltar à pergunta inicial** ("GraphQL é mais rápido que REST?") e responder em poucas linhas, do resultado ao mecanismo:

| Cenário | O que se observou | Mecanismo |
|---|---|---|
| Consulta simples | REST menor ou igual, por décimos de ms | GraphQL paga parse, validação e execução da query |
| Over-fetching | GraphQL recebe cerca de 7 a 10 vezes menos bytes; em loopback o tempo empata, a 5 Mbps o tempo acompanha os bytes | O cliente declara os campos; o SELECT traz só as colunas pedidas; cada byte custa na banda |
| Relacionamentos | GraphQL e BFF fazem 1 requisição; REST de recursos faz 1+1+N; com 50 ms, cerca de 360 ms contra cerca de 52 ms, e as retas da varredura se abrem | Cada requisição paga a latência inteira; o que decide é o número de idas e voltas |
| N+1 | 51 contra 1 consulta SQL para a mesma tela | Quem decide é a estratégia do servidor, não o protocolo |
| Volume (se rodou) | Dezenas de MB, segundos e GB de memória | Pedir tudo custa o mesmo em qualquer protocolo; em produção, pagine e limite |

**A tese:** "Não existe tecnologia vencedora. O resultado **depende do padrão de acesso aos dados**: quantos recursos a tela costura, quanto do recurso ela usa, **quanto custa cada ida à rede**, quanto custa cada byte e como o servidor busca no banco."

**O que a rede simulada ensinou:** a rede cobra duas vezes. Cada **ida e volta** custa a latência inteira (REST de 7 requisições paga 7 vezes) e cada **byte** custa na banda (REST de recurso inteiro paga mais). GraphQL e BFF reduzem as duas coisas, por caminhos diferentes; **BFF e GraphQL empataram**, e isso diz que a vantagem é do número de idas e voltas, não da tecnologia.

**Tabela "quando usar cada um"** (projete ou deixe numa lâmina):

| Situação | Tende a favorecer | Por quê | Cuidados |
|---|---|---|---|
| Recursos simples e estáveis, leitura por identificador, muito reaproveitamento de cache (catálogos, CRUD) | REST | Menor custo por requisição; URI endereçável e cache HTTP; simplicidade | Over-fetching se o recurso for grande; versionar rota ou cabeçalho |
| Vários tipos de cliente (web, mobile, parceiros) com necessidades de campos diferentes e telas que mudam rápido | GraphQL | O cliente escolhe os campos; menos bytes; schema tipado como contrato | Custo de query, DataLoader ou projeção, cache mais difícil |
| Tela que costura vários recursos relacionados e rede cara ou lenta | GraphQL ou endpoint sob medida (BFF) | 1 requisição no lugar de 1+N: uma ida e volta em vez de várias (medido com a rede simulada) | GraphQL: conferir o SQL gerado. BFF: um endpoint por tela, acoplamento |
| Tela estável, mesma equipe controla cliente e servidor, desempenho crítico | REST com BFF | Controle total da consulta e melhor resultado possível | Proliferação de endpoints |
| Comunicação interna entre serviços com alta vazão e contrato binário | gRPC (cap. 8; não medido aqui) | HTTP/2 com Protobuf, contrato `.proto` | Sem suporte nativo em navegadores (gRPC-Web); formato binário, menos legível |
| Notificação de eventos e mensageria confiável | Webhook ou AMQP (cap. 8) | Comunicação assíncrona (push ou filas): outro problema | Fora do escopo deste laboratório |
| API pública para terceiros desconhecidos | REST, ou GraphQL com governança | Custo previsível por endpoint contra flexibilidade que exige limites | Limites de profundidade e custo, paginação com teto, autenticação (não exercitados aqui) |

**Regra que vale para qualquer escolha:** meça o **número de requisições** e o **número de consultas SQL por requisição**. Idas e voltas e N+1 independem do protocolo.

**O que o experimento não diz:** custo em rede real (a rede simulada é um modelo simples), efeito de cache, segurança, custo operacional, gRPC, escrita (mutations) e eventos. É um experimento sobre padrões de acesso de leitura, não um veredito.

**Frase final:** "Meça o seu padrão de acesso. Olhe as contagens antes dos tempos, e conte quantas vezes a sua tela atravessa a rede."

**Bônus (só se o ensaio mostrar que cabe):** clique em "Executar todos os cenários" no início deste bloco e fale a tese enquanto roda (o `volume` entra com os padrões do cenário, 3 iterações sem warm-up, e acrescenta cerca de 35 a 45 s); ao terminar, a seção 10 (Matriz-resumo) mostra todos os cenários lado a lado. Mantenha as mãos fora do mouse durante a execução.

## Perguntas prováveis da banca

**1. A rede simulada é realista?**
Não por completo, e dizemos isso: é um **modelo simples**. O atraso de cada requisição é um valor fixo (a latência escolhida) mais o tempo de transferir os bytes na banda escolhida (bytes × 8 ÷ banda). Não há perda de pacotes, variação de atraso (jitter), handshake de TCP e TLS, partida lenta do TCP, HTTP/2 nem compressão; os bytes de cabeçalho não entram na conta; e a banda é um enlace único compartilhado entre requisições simultâneas, sem controle de congestionamento nem justiça entre fluxos. O atraso é injetado no cliente do laboratório depois que a resposta chega por loopback; o tráfego em si continua local. Os valores de 20, 50 e 100 ms e de 5 Mbps são escolhas didáticas, não medições de uma rede específica. O que o modelo acerta é o **mecanismo** (cada ida e volta custa a latência inteira, cada byte custa na banda) e a **ordem de grandeza**. Conferimos que o atraso injetado bate com o pedido (erro mediano de milésimos de ms, nenhuma amostra fora de 1 ms) e que a conta de banda bate com a fórmula, mas isso valida a **simulação**, não o realismo da rede. O mesmo resultado qualitativo (retas que se abrem com inclinação igual ao número de requisições) vale para qualquer latência fixa por requisição.

**2. Por que não há ponto de cruzamento?**
A varredura de rede procura a latência a partir da qual a ordem entre duas variantes se inverte. Nos cenários do laboratório isso não acontece, e é um resultado legítimo: a variante com 1 requisição (BFF ou GraphQL) já está à frente com rede zero (no `nested`, GraphQL 2,6 ms contra REST 7,8 ms na varredura) e, a cada +10 ms de latência, ganha mais ainda (cerca de +71 ms para o REST contra cerca de +10 ms). As duas variantes de 1 requisição ficam paralelas entre si. As retas **se abrem**, não se cruzam. Um cruzamento exigiria uma variante com menos idas e voltas que fosse **mais lenta em loopback**, por exemplo um GraphQL com SQL ruim (a consulta única com `LEFT JOIN` aninhado no SQLite, que o laboratório evita com `AsSplitQuery`, chegou a perder para o REST de 7 requisições); aí a rede, que penaliza as 7 idas e voltas, o faria passar à frente em algum ponto. Essa é uma hipótese: o laboratório não tem essa variante e **não cria uma só para forçar o gráfico**. A tela diz isso nos dados ("Nenhum cruzamento...").

**3. E se o REST fizer as chamadas em paralelo?**
Ajuda, mas não resolve. Com a opção "REST em paralelo" e 50 ms, o REST cai de cerca de 359 para cerca de 154 ms (exemplo de uma execução), porque os 5 itens saem juntos. Mas ainda são 3 idas e voltas em cascata (cliente, pedidos, itens): os ids dos pedidos só chegam na resposta anterior. O melhor que um cliente esperto faria é disparar cliente e pedidos juntos, 2 ondas, e nunca chegaria a 1. O GraphQL e o BFF ficam em cerca de 52 ms. Além disso, requisições, SQL e bytes não mudam: paralelismo esconde latência, não elimina trabalho, e a tela avisa que os atrasos se sobrepõem. (O laboratório paraleliza só os itens.)

**4. Então o BFF resolve tudo?**
Resolve o problema de **idas e voltas** tão bem quanto o GraphQL: com 50 ms, BFF e GraphQL deram cerca de 52 ms (empate técnico). É por isso que a lição é o número de idas e voltas, não a tecnologia. Mas o BFF tem custos próprios: é um endpoint por tela (ou por tipo de cliente), acoplado à tela; cada mudança de tela mexe no servidor; vários clientes com necessidades diferentes multiplicam endpoints; e o cliente não escolhe campos. O GraphQL deixa o cliente declarar o que quer, ao custo de governar custo de query, profundidade e cache. Nenhum dos dois dispensa olhar o SQL por trás (o BFF também pode ter N+1). A escolha é de contexto: BFF para telas estáveis sob o mesmo time, GraphQL quando há muitos clientes e telas mudando.

**5. E o cache HTTP? Não favorece o REST?**
Sim, na prática. No REST, cada recurso tem uma URI e, em geral, `GET`; navegadores, proxies e CDNs cacheiam por URL com `Cache-Control` e `ETag`. Em GraphQL, quase tudo é `POST` para uma única URL, então o cache HTTP não se aplica por padrão. As saídas são consultas persistidas via `GET`, cache normalizado no cliente e DataLoader por requisição. O laboratório **não usa cache nenhum** (nem cabeçalhos de cache nem requisições condicionais), então mede o caminho até a origem; com cache, o REST em recursos populares pode ficar muito melhor.

**6. E o versionamento?**
No REST, versiona-se por rota (`/v2/...`) ou cabeçalho, ou evolui-se de forma aditiva. No GraphQL, o schema evolui de forma aditiva: acrescentar campo não quebra clientes, porque cada um pede explicitamente o que usa; remover exige marcar o campo como obsoleto e acompanhar o uso. Nenhum dos dois dispensa governança de contrato. O laboratório tem uma só versão.

**7. Segurança e custo de query: o cliente GraphQL não pode pedir uma query caríssima?**
Pode, e é um risco real do GraphQL: aninhamento profundo e listas multiplicam o custo (cliente, pedidos, itens, produto). O cenário `volume` mostra o extremo: pedir 100 mil produtos com todos os campos gera uma resposta de cerca de 80 MB, e o servidor chega a cerca de 3,5 GB de memória com 8 clientes assim em paralelo. Mitigações: limite de profundidade, análise de custo da query, paginação com teto, tempo limite, consultas persistidas, limite de taxa por custo e autorização por campo. No REST o custo é limitado pelo desenho de cada endpoint, mas também exige limite de taxa e paginação (o `GET /api/products?take=100000` do laboratório devolve a mesma base inteira). **No laboratório não há autenticação, autorização nem limites de profundidade ou de custo configurados**; o `take` é limitado a 100.000 tanto no REST quanto no GraphQL, o que é muito. É exatamente o tipo de ponto a tratar antes de ir para produção.

**8. N+1 é um problema do GraphQL?**
Não é do protocolo. É de como o servidor busca os dados. Ocorre em REST também, se o endpoint faz uma consulta por item. No GraphQL é mais fácil de cair, porque a execução é por campo. As defesas são DataLoader (lote), projeção (JOIN) ou consulta feita sob medida. Em qualquer caso, monitore o número de consultas SQL por requisição.

**9. Por que não incluíram gRPC?**
O capítulo 8 o posiciona para desempenho entre microsserviços (HTTP/2 e Protobuf) e ele não tem suporte nativo em navegadores. A pergunta do laboratório é outra: quem define o formato dos dados que uma tela consome (servidor ou cliente) e como isso afeta requisições, bytes e consultas. O gRPC muda o eixo de transporte e serialização; N+1 e over-fetching continuariam dependendo de como os métodos são desenhados. É uma extensão natural como trabalho futuro (uma terceira variante nos mesmos cenários).

**10. Os resultados são válidos? Dá para generalizar?**
Para **mecanismos e ordens de grandeza**, sim; para **valores absolutos**, não. As contagens (requisições, SQL, bytes, campos) são determinísticas e independentes da máquina. Os tempos valem para esta máquina e este momento. Ameaças reconhecidas (detalhadas no [README](README.md#8-limitações-e-ameaças-à-validade)): rede simulada que é um modelo simples (atraso fixo por requisição mais bytes ÷ banda, sem perda, jitter, handshake nem HTTP/2) sobre um loopback; HTTP/1.1 sem compressão nem cache; cliente e servidor no mesmo processo; SQLite in-process; dados sintéticos; consulta sempre ao mesmo registro; CPU e memória do processo inteiro; varredura com poucas iterações por ponto; e implementações que diferem além do protocolo. Mitigações: warm-up, cold à parte, blocos intercalados, percentis, repetição de runs.

**11. Por que o GraphQL aparece com 3 consultas SQL no cenário de relacionamentos, se é uma query só?**
Porque 1 requisição não é 1 consulta. O SQL gerado pela projeção automática do EF Core em uma consulta única tem subconsultas aninhadas que o SQLite materializa a cada execução (cerca de 5 ms; nessa forma o GraphQL perdia até para o REST de 7 requisições). O laboratório usa `AsSplitQuery`: cliente, pedidos e itens com produto em 3 consultas simples. No PostgreSQL a consulta única já era boa e a divisão custa 3 idas e voltas. É característica do SQL gerado e do banco, não do GraphQL, e a lição é olhar o SQL.

**12. Por que SQLite? Não deveria ser um banco de verdade?**
O padrão é SQLite para que qualquer pessoa rode sem instalar nada. Mas ele roda dentro do processo, o que disfarça o custo do N+1. Por isso existe o modo PostgreSQL opcional, em contêiner, com o mesmo seed, mesmas rotas e mesmas contagens de SQL; muda o custo de cada ida ao banco. (A rede simulada é outra coisa: atua entre o cliente e o servidor, não entre o servidor e o banco.)

**13. Por que 100 mil produtos? O cenário volume é realista?**
Não é um uso realista, é um teste de estresse deliberado: em produção ninguém devolve 100 mil registros numa resposta, os dois lados paginariam. A base grande existe para que o `volume` mostre o custo de serializar, trafegar e manter na memória dezenas de MB, e como o GraphQL com poucos campos reduz isso cerca de 10 vezes, enquanto o GraphQL pedindo todos os campos pesa o mesmo que o REST. Os outros cenários continuam lendo poucas linhas (produto 150, 50 produtos, cliente 15), com as mesmas respostas de antes; o tamanho da base não os muda.

**14. E mutations e subscriptions?**
Fora do escopo: o laboratório mede leitura. As operações de escrita e de tempo real têm outras questões (consistência, transações, conexões persistentes).

**15. Posso usar os dois ao mesmo tempo?**
Pode, e é comum: este laboratório expõe REST e GraphQL sobre o mesmo contexto de dados. Um arranjo frequente é REST (ou endpoints sob medida) para integrações simples e públicas e GraphQL para clientes ricos, desde que haja governança.

## Plano B

| Se acontecer | Faça | Diga |
|---|---|---|
| Servidor não sobe porque a porta 5080 está ocupada | `netstat -ano \| findstr :5080` e `taskkill /PID <pid> /F` (Windows); ou suba com `-- --urls http://localhost:5090` e abra essa porta (a troca de porta foi exercitada, e o motor descobre o endereço do próprio servidor) | (nada; resolva antes de começar) |
| `dotnet` não encontra o SDK 9 | `dotnet --version`; instale o .NET 9 SDK | |
| Primeira subida demora (criação do banco e carga dos 100.000 produtos, alguns segundos) | Espere a faixa de ambiente mostrar 100.000 produtos antes de abrir a plateia. Faça a primeira subida bem antes da apresentação | |
| Dashboard abre, mas o run falha ou trava | Botão **Cancelar**; ou "Acompanhar o run em andamento" se aparecer o aviso de conflito; reinicie o servidor se necessário | "Vou mostrar o resultado de uma execução anterior." |
| Execução ao vivo inviável | Seção **09 Histórico** e botão **Ver** reabrem um run anterior (ficam em memória: se o servidor reiniciou, somem). Alternativa: prints tirados no ensaio | "Estes números são de uma execução que fiz antes; o mecanismo é o mesmo." |
| Esqueceu de reduzir as iterações com a rede ligada e o run não acaba | **Cancelar**; volte ao perfil B (30 iterações, warm-up 10) e execute de novo | |
| Os números com 50 ms ficaram bem diferentes dos do ensaio (por exemplo, REST muito acima de 360 ms) | Confira a rede da tela: latência 50, banda **Sem limite** (banda esquecida em 5 Mbps soma tempo de transferência), "REST em paralelo" desligado; feche outros programas e repita | |
| A varredura demora, trava ou dá erro | **Cancelar** (as etapas concluídas permanecem no gráfico); mostre o print do ensaio, ou as duas execuções já feitas (loopback e 50 ms) que dão o mesmo recado | "O gráfico completo é de um ensaio; a inclinação é o número de requisições." |
| Números ruidosos, empate inesperado ou outliers | Rode de novo (em loopback, 1.000 ou mais iterações; com rede, algumas dezenas); feche outros programas; confira que ninguém mexe no navegador durante o run | Use o P99 para explicar a cauda; diferenças menores que 3% (ou que a dispersão medida) são empate técnico |
| A varredura não mostra cruzamento | É o esperado: o texto da tela diz "Nenhum cruzamento...". Siga o roteiro | "As retas se abrem: a variante de 1 requisição já ganha com rede zero." |
| GraphQL perde para o REST de 1+1+N no cenário de relacionamentos | Repita o run (ruído da máquina) e confira "Consultas SQL" = 3; se persistir, siga o roteiro: é uma lição, não um erro | Explique o SQL gerado (pergunta 11 da banca) |
| O volume fica lento, a memória sobe ou o servidor trava | **Cancelar**; **não aumente a concorrência** (o cenário limita a 2 por causa da memória); pule o 5.5; se o servidor ficou pesado, reinicie e aqueça antes de continuar | "Este cenário é o extremo: por isso o laboratório limita a concorrência." |
| Docker indisponível ou PostgreSQL não conecta | **Pule o bloco 6 e siga em SQLite**; o laboratório funciona integralmente sem Docker | "A contagem é a mesma: 51 contra 1 consulta. Com o banco em rede, cada uma pagaria uma ida e volta de rede; aqui já aparece mesmo com o banco em processo." |
| Abrir `/graphql` (IDE) falha | Mostre o schema em `/graphql?sdl` | |
| Projetor: texto pequeno ou contraste ruim | Zoom do navegador (`Ctrl` e `+`); botão "Tema escuro" ou "Tema claro" | |
| Sem internet | Não afeta: o dashboard não usa recursos externos | |

## Checklist pré-apresentação

**Dias antes**

- [ ] `dotnet --version` mostra 9.x e `dotnet build -c Release` termina sem erros.
- [ ] Primeira subida feita pelo menos uma vez (cria o banco e carrega os 100.000 produtos); faixa de ambiente mostra 100.000 produtos.
- [ ] Ensaio completo cronometrado (versão 20 min e, se for o caso, 15 min), **incluindo a varredura de rede (cerca de 1 min estimado) e o volume**. Anote quanto leva cada run.
- [ ] Anote as medianas do ensaio de cada cenário, em loopback e com a rede ligada (50 ms; 5 Mbps no over-fetching em lista). Se na hora os valores forem muito diferentes, algo está consumindo a máquina ou a rede da tela está diferente do planejado.
- [ ] Tire prints dos resultados de cada cenário e do gráfico da varredura (backup do plano B).
- [ ] Teste abrir `/graphql` sem internet. O HTML e o JavaScript do IDE (Nitro) são servidos pelo próprio servidor, sem CDN (conferido no HTML e no bundle principal), e a introspecção está habilitada, então o schema aparece; ainda assim, ensaie sem rede e tenha `/graphql?sdl` como alternativa.
- [ ] Se for usar o bloco 6: `docker compose up -d`, `docker compose ps` com `healthy`, servidor em modo PostgreSQL semeado uma vez, `nplus1` executado em ensaio. Decida entre as opções A e B de troca.
- [ ] Revise as perguntas da banca e o que foi (ou não foi) medido.

**No dia, antes de começar**

- [ ] Notebook na tomada e modo de energia de alto desempenho.
- [ ] Fechar aplicativos pesados e abas desnecessárias; silenciar notificações. Memória livre para o volume (o processo chegou a 1,0 a 1,5 GB medidos com um cliente por vez).
- [ ] Porta 5080 livre.
- [ ] Rodar em **Release**, fora do depurador: `dotnet run -c Release --project src/ApiBenchmark.Web`.
- [ ] **Aquecer com uma rodada antes da plateia chegar:** um "Executar todos os cenários" (com iterações baixas) e um run curto do `nested` com a rede ligada (por exemplo, 20 ms, 10 iterações). Isso paga JIT, EF Core e Hot Chocolate, e exercita o caminho da rede simulada. A primeira execução depois de subir o processo é a menos confiável.
- [ ] Decisão sobre o cold run "desde o start": se aquecer, o cenário `simple` não mostrará mais a marca "1ª desde o start" (cada run continua tendo seu cold run). Aquecer é o recomendado; se quiser mostrar o cold de verdade, assuma que o primeiro run é o menos confiável. Escolha uma das duas e mantenha.
- [ ] Abrir `http://localhost:5080`; conferir a faixa de ambiente (100.000 produtos, e o banco em uso se houver o campo).
- [ ] Estado inicial da tela: rede **desligada** (0 ms, Sem limite), "REST em paralelo" **desligado**, perfil A (1.000 iterações, warm-up 50, concorrência 1).
- [ ] Zoom e tema do navegador ajustados ao projetor.
- [ ] Este roteiro aberto num segundo monitor ou impresso; cronômetro visível.
- [ ] Combinar consigo mesmo: **não mexer no navegador durante um run** (nem na varredura).

## Anexo. Exemplo de uma execução (somente ilustração)

Os valores abaixo **não são resultados fixos**: seus números serão diferentes. O que se espera preservar é o padrão relativo e, principalmente, as contagens. Há duas rodadas de medição e uma observação do cenário `volume`, todas em Windows, com SQLite e concorrência 1 salvo indicação.

### Rodada com rede (a mais recente: rede simulada e base de 100.000 produtos)

Medianas em ms, medidas nesta máquina:

| Cenário | Configuração | `rest` | `rest-bff` | `graphql` |
|---|---|---|---|---|
| nested | loopback | 3,6 | 0,7 | 1,1 |
| nested | 50 ms por requisição | 359 | 51,6 | 52,0 |
| nested | 50 ms, REST em paralelo | 154 | | |

`overfetching-list` com banda de 5 Mbps e latência 0: `rest` 68,7 ms (41.883 B recebidos) contra `graphql` 8,5 ms (4.301 B recebidos).

Varredura de rede do `nested` (mediana em ms, no máximo 30 iterações por etapa):

| Latência | 0 ms | 20 ms | 50 ms | 100 ms |
|---|---|---|---|---|
| `rest` (7 requisições) | 7,8 | 158 | 369 | 719 |
| `graphql` (1 requisição) | 2,6 | 24 | 54 | 105 |

Inclinação: cerca de +71 ms por +10 ms de latência no REST (7 requisições) contra cerca de +10 ms no GraphQL (1 requisição). Nenhum cruzamento. Contas de banda conferidas: `overfetching-list` a 5 Mbps, o REST (41.883 B recebidos e 36 B enviados) paga 67,07 ms de transferência e o GraphQL (4.301 B e 77 B), 7,01 ms.

### Rodada anterior (base de 500 produtos, sem rede simulada, modo Release)

**300 iterações, warm-up 50, processo recém-iniciado** (mediana em ms; bytes recebidos, requisições HTTP e consultas SQL por operação). As contagens são determinísticas e continuam valendo; os tempos são só desta rodada (o `nested` em loopback aparece aqui com REST 2,6 ms e na rodada com rede com 3,6 ms: rodadas e momentos diferentes, os tempos variam e as contagens não):

| Cenário | Variante | Mediana (ms) | Bytes recebidos | Requisições | SQL |
|---|---|---|---|---|---|
| simple | rest | 0,331 | 834 B | 1 | 1 |
| simple | graphql | 0,518 | 855 B | 1 | 1 |
| overfetching | rest | 0,317 | 834 B | 1 | 1 |
| overfetching | graphql | 0,380 | 112 B | 1 | 1 |
| overfetching-list | rest | 0,791 | 41.883 B | 1 | 1 |
| overfetching-list | graphql | 0,547 | 4.301 B | 1 | 1 |
| nested | rest | 2,616 | 14.912 B | 7 | 7 |
| nested | rest-bff | 0,473 | 1.837 B | 1 | 1 |
| nested | graphql | 0,823 | 1.859 B | 1 | 3 |
| nplus1 | rest | 0,827 | 11.520 B | 1 | 1 |
| nplus1 | graphql-naive | 8,807 | 4.957 B | 1 | 51 |
| nplus1 | graphql-dataloader | 2,037 | 5.057 B | 1 | 2 |
| nplus1 | graphql-projection | 1,058 | 4.701 B | 1 | 1 |

Outras observações dessa rodada:

- `nested` com "REST em paralelo", em loopback: REST 2,03 ms (ainda 7 requisições e 7 SQL); BFF 0,73 ms; GraphQL 1,28 ms.
- `nested` com concorrência 4: REST 3,87 ms, BFF 0,70 ms e GraphQL 1,08 ms.
- Campos JSON usados pela tela contra recebidos: `overfetching` REST 3 de 15, GraphQL 3 de 3; `overfetching-list` REST 150 de 750, GraphQL 150 de 150; `nested` REST 53 de 282, BFF e GraphQL 53 de 53; `nplus1` REST 200 de 500, GraphQL 200 de 200.

**Mesma bateria com o modo PostgreSQL** (rodada anterior, 300 iterações, warm-up 50, `Database:Provider=postgres`, contêiner local; contagens de SQL idênticas às do SQLite): `simple` REST 2,07 ms e GraphQL 2,70 ms; `overfetching` 2,14 e 1,97 ms; `overfetching-list` 3,33 e 2,18 ms; `nested` REST 13,09 ms, BFF 2,56 ms e GraphQL 5,71 ms; `nplus1` REST 2,39 ms, ingênuo 13,29 ms, DataLoader 4,69 ms e projeção 3,08 ms. Diferenças pequenas (como `overfetching`, 2,14 contra 1,97 ms) são empate técnico.

### Cenário volume (medido durante o desenvolvimento)

SQLite, build Release, máquina com outros programas abertos, uma consulta completa por vez; só ordem de grandeza: REST 83.550.652 B em 3,5 a 3,7 s; GraphQL com 3 campos 8.361.921 B em cerca de 1,05 s; GraphQL com todos os campos 83.550.674 B em cerca de 6,0 s; run completo com os padrões do cenário (3 iterações, warm-up 0): 42 a 45 s. Memória: o processo inteiro (servidor e motor) chegou a 1,0 a 1,4 GB com um cliente por vez (o servidor sozinho, perto de 0,85 GB); o servidor chegou a cerca de 3,5 GB com 8 clientes completos em paralelo.

Os valores acima mudam de máquina para máquina e de rodada para rodada (nesta máquina, os mesmos cenários variam facilmente algumas dezenas de por cento entre execuções).

**Como usar estes valores no palco:** cite apenas como "exemplo de uma execução", sempre depois de mostrar os números ao vivo, e prefira falar de proporções e de contagens.
