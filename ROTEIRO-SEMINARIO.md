# Roteiro do seminário: REST vs GraphQL, medido ao vivo

Duração alvo: 15 a 20 minutos. Ferramenta de apoio: o dashboard do API Performance Lab (`http://localhost:5080`). Detalhes técnicos e limitações estão no [README](README.md) e em [`docs/CONTRATO.md`](docs/CONTRATO.md).

**Princípio do roteiro.** Os números do dashboard são medidos na hora e mudam a cada execução e a cada máquina. Este documento descreve **tendências e mecanismos**; os valores que aparecem como "exemplo de uma execução" vêm de uma rodada de verificação em Windows, em modo Release, e servem só de ilustração. Não os apresente como resultados do laboratório: apresente o que a tela mostrar.

**Vocabulário.** Usado como no capítulo 8 do livro-texto (Tecnologias e Protocolos para Arquiteturas de Serviços): comunicação síncrona de requisição e resposta, REST como estilo arquitetural (recursos identificados por URI, endereçabilidade, interface uniforme, ausência de estado), GraphQL como linguagem de consulta e mecanismo de execução com schema tipado, over-fetching e under-fetching.

## Cronograma

| Início | Bloco | Versão 20 min | Versão 15 min |
|---|---|---|---|
| 0:00 | 1. Abertura e pergunta-problema | 1:30 | 1:30 |
| 1:30 | 2. REST e GraphQL em 3 minutos | 3:00 | 2:00 |
| 4:30 | 3. Arquitetura do experimento e por que a comparação é justa | 2:00 | 1:30 |
| 6:30 | 4. Apresentando a tela | 1:00 | 0:30 |
| 7:30 | 5.1 Demonstração: consulta simples | 1:00 | 0:30 |
| 8:30 | 5.2 Demonstração: over-fetching | 1:30 | 1:00 |
| 10:00 | 5.3 Demonstração: relacionamentos | 2:30 | 2:00 |
| 12:30 | 5.4 Demonstração: N+1 | 2:30 | 2:00 |
| 15:00 | 6. Opcional: N+1 em PostgreSQL | 1:30 | cortado |
| 16:30 | 7. Fechamento: a tese e a tabela de decisão | 2:00 | 1:30 |
| 18:30 | Margem para atrasos | 1:30 | 2:30 |

Os horários nos títulos dos blocos abaixo são os da versão de 20 minutos. Se as perguntas da banca entrarem no tempo total, use a versão de 15 minutos. Ponto de corte se estiver atrasado: pule o cenário `simple` (conte em uma frase), depois o bloco 6.

## Bloco 1. Abertura e pergunta-problema (0:00 a 1:30)

**Mostrar:** dashboard aberto no primeiro cenário (ou um slide com a pergunta).

**Dizer:**

- "Uma tela precisa mostrar o nome de um cliente, a data e o total de cada pedido dele e o nome e o preço de cada produto. Com REST orientado a recursos, para o cliente 15 do nosso banco são 7 requisições. Com GraphQL, é 1 query. Qual é melhor?"
- "Se eu perguntar 'GraphQL é mais rápido que REST?', a resposta honesta é 'depende'. Hoje vamos medir de quê."
- Anunciar o formato: "Vou mostrar quatro situações reais de acesso a dados. Em cada uma, a mesma base de dados, as duas APIs, e números medidos ao vivo, não slides."
- As quatro perguntas que organizam a demonstração:
  1. Pedir "tudo igual" em GraphQL custa mais? (consulta simples)
  2. Pedir só o que a tela usa economiza o quê? (over-fetching)
  3. Uma query no lugar de várias requisições resolve? (relacionamentos)
  4. O que acontece por trás de uma única requisição? (N+1)

**Interação (opcional, 20 s):** peça um palpite por levantar de mão ("quem acha que GraphQL é mais rápido? REST? depende?"). Retome no fechamento.

## Bloco 2. REST e GraphQL em 3 minutos (1:30 a 4:30)

### REST (1:30 a 2:30)

- Estilo arquitetural, não protocolo (cap. 8, §8.4): dados modelados como **recursos**, cada um com uma **URI**; três princípios: endereçabilidade, interface uniforme (verbos HTTP) e ausência de estado.
- Cada rota devolve a representação do recurso: `GET /api/products/150`, `GET /api/customers/15/orders`.
- Vantagens: simples, previsível, cacheável por URL com os mecanismos do próprio HTTP.
- Contrapartida: **o servidor decide o formato** da resposta.

### GraphQL (2:30 a 3:30)

- Linguagem de consulta e mecanismo de execução (cap. 8, §8.5). Um único endpoint (`POST /graphql`), **schema tipado** como contrato, e o **cliente declara os campos** que quer.
- Três operações no livro (query, mutation, subscription); neste laboratório só há **leitura**, ou seja, queries.
- Escrever no quadro: `{ product(id: 150) { name price sku } }`.
- Lembrar a armadilha do capítulo: GraphQL **não é um banco de dados**. É uma camada de comunicação sobre HTTP; atrás dela ainda existe um banco. Guarde essa frase para o bloco do N+1.

### Os três problemas (3:30 a 4:30)

- **Over-fetching:** a resposta traz mais do que a tela usa.
- **Under-fetching:** a tela precisa de dados de vários recursos e faz várias requisições (1+1+N). Desenhar a comparação do capítulo: três chamadas REST contra uma consulta GraphQL.
- **N+1:** problema do servidor, não do protocolo. Lista de 50 pedidos com o cliente de cada um: 1 SELECT para os pedidos e mais 50 SELECTs, um por cliente.
- Gancho: "Cada um desses três problemas virou um cenário que vamos medir."

## Bloco 3. Arquitetura do experimento e por que a comparação é justa (4:30 a 6:30)

**Mostrar:** o diagrama do [README](README.md#3-arquitetura) (abra o arquivo no GitHub ou use um slide).

**Dizer (percorrendo o diagrama):** dashboard no navegador inicia o run, o motor de benchmark chama o próprio servidor por HTTP, o servidor expõe REST e GraphQL, e os dois usam o mesmo EF Core e o mesmo banco.

**Por que a comparação é justa (cinco pontos):**

1. **Mesma base e mesmo seed:** os dois lados leem exatamente os mesmos dados.
2. **HTTP real, não chamada de método:** o motor faz requisições por loopback, então roteamento, serialização e parse contam para os dois.
3. **Mesma máquina, mesmo processo, mesmo cliente de medição.**
4. **Protocolo de medição:** cold run à parte, warm-up descartado, blocos intercalados com ordem alternada (ninguém roda sempre por último), mediana e percentis P95 e P99 em vez de só média.
5. **Nada fixo na tela:** o SQL é contado por um interceptor do EF Core, os bytes são contados no corpo da resposta, os campos são contados no JSON.

**Ressalvas (diga antes que a banca diga):**

- É **loopback**: não há rede de verdade. Isso subestima o custo de várias requisições e de bytes extras.
- As **implementações diferem** além do protocolo: o REST monta DTOs à mão; o GraphQL usa projeção automática. Compara-se REST e GraphQL *implementados nesta pilha*.
- Cliente e servidor estão no **mesmo processo**: CPU e memória são do processo inteiro.

**Frase-chave:** "Confiem mais nas **contagens** (requisições, consultas SQL, bytes, campos), que são determinísticas, do que nos **tempos**, que variam com a máquina. Os tempos mostram ordem de grandeza."

## Bloco 4. Apresentando a tela (6:30 a 7:30)

Percorra de cima para baixo, em ritmo de tour:

- **Faixa de ambiente:** versão do .NET, sistema, núcleos e contagens reais do banco (e, no modo PostgreSQL, qual banco está em uso).
- **01 Cenário:** cada cartão traz "A tela precisa". Clicar mostra as requisições de cada variante, com o texto exato (GET ou query GraphQL).
- **02 Configuração:** iterações, warm-up e concorrência. Use os padrões (1.000, 50 e 1) durante toda a demonstração.
- **Barra de progresso:** passos Cold run, Warm-up, Benchmark, Concluído.
- **03 a 07:** cartões por variante (mediana em destaque), comparativo (melhor valor marcado, razão ×, "empate técnico" quando a diferença é menor que 3% ou que a dispersão medida no próprio run), gráficos, trace das requisições e um texto de leitura gerado a partir dos números.
- Avise: "Não vou tocar na tela durante os runs. Qualquer requisição extra entra nas métricas."

## Bloco 5. Demonstração ao vivo, cenário a cenário

Para cada cenário: peça um palpite rápido, clique, e use o tempo de execução para falar do que está acontecendo (cold, warm-up, blocos). Cada run de 1.000 iterações leva de alguns segundos a algumas dezenas de segundos; cronometre no ensaio. A primeira execução de cada variante depois que o servidor subiu leva pelo menos 1 s a mais por variante (warm-up estendido), e no PostgreSQL o tempo total é maior.

### 5.1 Consulta simples (7:30 a 8:30)

- **Clique:** cenário "Consulta simples (mesmo payload)" e EXECUTAR BENCHMARK. Se o servidor acabou de subir, aproveite: é a primeira execução, então o **cold run** aparece com a marca "1ª desde o start".
- **Aponte:**
  - mediana de cada variante;
  - "Cold run" bem acima da mediana (JIT, conexões, caches: custo da primeira vez, não do estilo de API);
  - "Bytes recebidos" quase iguais e "Bytes enviados" maiores no GraphQL (a query vai no corpo de um POST);
  - "Consultas SQL" iguais.
- **Tendência esperada:** REST com latência menor ou igual; GraphQL com um custo fixo adicional; payload e SQL equivalentes.
- **Por quê:** o GraphQL faz trabalho extra a cada requisição (parse do documento, validação contra o schema, planejamento e execução dos resolvers, montagem da resposta). O REST vai direto ao handler. O SQL é o mesmo, então a diferença é o custo do mecanismo de execução.
- **Exemplo de uma execução (300 iterações, warm-up 50):** REST cerca de 0,33 ms e GraphQL cerca de 0,52 ms; 834 B contra 855 B recebidos.
- **Frase:** "É o ponto fraco que o livro atribui ao GraphQL: mais lento em consultas simples. O custo é pequeno em termos absolutos e é o preço da flexibilidade."
- **Se der empate técnico (diferença menor que 3% ou que a dispersão medida):** diga isso: sem diferença detectável aqui. Não force uma história.
- **Gancho:** "Então por que alguém pagaria esse custo? Próximo cenário."

### 5.2 Over-fetching (8:30 a 10:00)

- **Clique:** cenário "Over-fetching" e executar.
- **Aponte:**
  - em "A tela precisa": só nome, preço e SKU;
  - nos cartões, "Bytes recebidos" do REST contra o do GraphQL e a barra listrada de "Campos JSON" (recebidos, usados, não usados);
  - em "O que trafegou", a resposta de amostra do REST (descrição longa, categoria e fornecedor) ao lado da do GraphQL (três campos).
- **Tendência esperada:** o GraphQL recebe uma fração dos bytes e nenhum campo sem uso; o REST descarta a maior parte do que recebe. Na **latência**, a diferença local é pequena e o REST pode empatar ou até ficar à frente.
- **Por quê:** o ganho do GraphQL aqui é em bytes e campos, e o SELECT traz só as colunas pedidas. Em loopback, transferir algumas centenas de bytes custa quase nada e o GraphQL ainda paga o custo fixo do cenário anterior. O benefício aparece onde bytes custam: rede móvel, plano de dados, listas grandes, muitos clientes simultâneos.
- **Franqueza obrigatória:** "O laboratório mede o desperdício de bytes, mas não consegue medir quanto esses bytes custariam numa rede de verdade."
- **Opcional (+30 s), se houver tempo:** cenário "Over-fetching em lista" (50 produtos). Mesma lógica multiplicada por 50: a resposta REST sobe para dezenas de KB contra poucos KB no GraphQL (confira na tela).
- **Exemplo de uma execução (300 iterações):** 834 B (REST) contra 112 B (GraphQL), cerca de 7 vezes menos; medianas de 0,32 ms (REST) e 0,38 ms (GraphQL); campos usados pela tela: 3 de 15 no REST e 3 de 3 no GraphQL.
- **Gancho:** "E quando a tela precisa de dados de vários recursos relacionados?"

### 5.3 Relacionamentos (10:00 a 12:30)

- **Clique:** cenário "Relacionamentos". **Antes de executar** (15 s), mostre as três variantes: `rest` (três tipos de GET, o último repetido N vezes), `rest-bff` (um GET) e `graphql` (uma query aninhada). Execute.
- **Aponte:**
  - "Requisições HTTP": 7 (REST, com o seed padrão), 1 (BFF) e 1 (GraphQL);
  - "Consultas SQL": 7 (REST), 1 (BFF) e **3 (GraphQL)**, não 1: veja a explicação logo abaixo; e "Bytes recebidos";
  - "Campos não usados": o REST recebe vários campos que a tela não usa; BFF e GraphQL, nenhum;
  - em "O que trafegou", a linha do tempo do REST com 7 chamadas em sequência.
- **Tendência esperada:** o REST orientado a recursos sofre o under-fetching (1+1+N requisições, mais bytes, campos desperdiçados). O endpoint sob medida (BFF) tende a ser o mais rápido. O GraphQL entrega o mesmo benefício estrutural do BFF (1 requisição, zero campo desperdiçado) e, no SQLite, costuma ficar entre o BFF e o REST de 7 requisições.
- **O detalhe que vale mostrar:** a query GraphQL é uma só, mas o servidor faz **3 consultas SQL** (cliente; pedidos; itens com produto), porque o laboratório usa `AsSplitQuery` do EF Core.
  - **Por quê:** com uma consulta só, a projeção automática do EF Core gera `LEFT JOIN` de subconsultas aninhadas que o SQLite materializa a cada execução (cerca de 5 ms); nessa configuração o GraphQL chegava a ficar mais lento que o REST de 7 requisições. O BFF usa uma consulta LINQ escrita à mão que o EF traduz em junções planas.
  - **O que isso ensina:** 1 requisição HTTP não é 1 consulta SQL, e o formato do SQL gerado pelo ORM muda o resultado. Não é falha do protocolo GraphQL; é o SQL gerado mais o planejador do banco. Lição de engenharia sobre confiar em projeção automática de ORM sem olhar o SQL. Em rede real, as 7 requisições do REST pesariam mais do que aqui.
- **Opcional (30 s): ligue "REST em paralelo"** e execute de novo. A latência do REST cai, mas requisições, SQL e bytes continuam os mesmos: paralelismo esconde latência, não elimina trabalho.
- **Exemplo de uma execução (300 iterações, warm-up 50):** REST 2,62 ms, BFF 0,47 ms e GraphQL 0,82 ms, com 7, 1 e 1 requisições e 7, 1 e 3 consultas SQL; REST em paralelo, 2,03 ms; campos usados pela tela: 53 de 282 no REST e 53 de 53 no BFF e no GraphQL.
- **Frase:** "GraphQL resolve o under-fetching na camada do protocolo, mas transfere a responsabilidade para a forma como o servidor busca os dados. E o BFF é a resposta REST para o mesmo problema, ao custo de acoplar um endpoint à tela."
- **Se a ordem na sua máquina for outra** (por exemplo, o GraphQL empata com o BFF ou o REST fica à frente): perfeito, diga que depende de máquina e plano de execução; repita o run, porque diferenças modestas invertem entre execuções. O que não muda são as contagens: 7 contra 1 requisições, 7, 1 e 3 consultas SQL, bytes e campos.
- **Gancho:** "Falta olhar o que acontece atrás de uma única requisição."

### 5.4 N+1 (12:30 a 15:00)

- **Clique:** cenário "N+1 no servidor GraphQL". Mostre que as três queries GraphQL são quase idênticas e mudam o campo do cliente: `customerNaive` e `customerBatched` (sobre `recentOrders`) e `customer` (sobre `orders`, com projeção). Execute.
- **Aponte:**
  - "Requisições HTTP": **1 em todas**;
  - "Consultas SQL": 1, 51, 2 e 1, para a mesma resposta na tela;
  - a ordem das medianas segue o número de consultas SQL;
  - o gráfico "Requisições HTTP e consultas SQL por operação".
- **Tendência esperada:** a variante ingênua é a mais lenta com folga, o DataLoader fica no meio e a projeção fica próxima do REST.
- **Por quê:**
  - Em GraphQL o resolver de um campo roda **uma vez por item** da lista. Sem estratégia, cada pedido dispara seu SELECT: 1 + 50 consultas.
  - O **DataLoader** junta as chaves pedidas no mesmo ciclo de execução e faz um único `WHERE id IN (...)`: 2 consultas.
  - A **projeção** traduz a árvore da query em um `JOIN` único: 1 consulta. O endpoint REST de lista já faz esse JOIN.
- **Ponto-chave:** "GraphQL reduz idas e voltas **HTTP**; não reduz idas ao **banco**." Lembre a frase do capítulo: GraphQL não é banco de dados. N+1 também ocorre em REST (um endpoint que faz uma consulta por item), mas a execução por campo do GraphQL torna a armadilha mais fácil de cair.
- **O banco in-process disfarça:** com SQLite dentro do processo cada consulta custa microssegundos, e ainda assim o N+1 fica várias vezes mais lento. Quando o banco está na rede, a conta piora (bloco 6).
- **Exemplo de uma execução (300 iterações, warm-up 50):** REST 0,83 ms; GraphQL ingênuo 8,81 ms (51 SQL); DataLoader 2,04 ms (2 SQL); projeção 1,06 ms (1 SQL). Bytes recebidos: 11.520 B no REST (200 de 500 campos usados) e cerca de 5 KB no GraphQL (200 de 200).
- **Gancho:** "Isso é com o banco dentro do processo. E se o banco não estivesse?" (bloco 6) ou "Vamos fechar." (bloco 7)

## Bloco 6. Opcional: N+1 em PostgreSQL (15:00 a 16:30)

Use só se estiver no horário **e** a preparação abaixo tiver sido ensaiada. Rode **um** cenário: `nplus1`.

**Preparação (antes da apresentação, não ao vivo):**

1. `docker compose up -d` e `docker compose ps` até aparecer `healthy`.
2. Subir o servidor com `dotnet run -c Release --project src/ApiBenchmark.Web -- --Database:Provider=postgres` **uma vez** para semear o banco, e conferir a faixa de ambiente.
3. Decidir como trocar durante a fala:
   - **Opção A (mais simples):** parar o servidor SQLite (`Ctrl+C`), subir o de PostgreSQL e recarregar a página. Leva alguns segundos; o histórico em memória do servidor anterior se perde.
   - **Opção B:** deixar um segundo servidor pronto em outra porta, adicionando `--urls http://localhost:5081` ao comando do PostgreSQL. Foi exercitada: dois servidores no ar ao mesmo tempo (SQLite em 5080 e PostgreSQL em 5081), cada um com o seu painel e o motor chamando o próprio servidor. Com dois servidores no ar, só use o painel de um por vez.

**Ao vivo:**

- **Mostre** a faixa de ambiente indicando `postgres` e diga o que mudou: o banco agora é um processo separado, falado por TCP.
- **Execute** `nplus1` com a mesma configuração.
- **Aponte:** as **contagens de SQL são idênticas** (1, 51, 2 e 1); o que muda é o tempo de cada consulta. Exemplo (300 iterações): REST 2,4 ms, ingênuo 13,3 ms, DataLoader 4,7 ms e projeção 3,1 ms, contra 0,8, 8,8, 2,0 e 1,1 ms no SQLite da mesma máquina.
- **Tendência esperada (confirme ao vivo):** a diferença em milissegundos entre a variante ingênua e as demais tende a aumentar em relação ao SQLite (a razão entre elas pode até diminuir, porque todas passam a ter um piso de latência maior), porque cada uma das 51 consultas agora paga uma ida e volta por TCP, enquanto REST e projeção pagam uma vez e o DataLoader, duas.
- **Lição de engenharia:** o custo do N+1 é (número de consultas) × (custo de uma ida e volta ao banco). Com banco in-process o segundo fator é quase zero e o erro passa despercebido em desenvolvimento; com banco em rede, aparece. Ambiente de desenvolvimento com SQLite pode esconder um problema que só surge em produção.
- **Cuidado ao falar de números:** não compare os tempos de PostgreSQL com os de SQLite como se fossem a mesma bateria (Docker no Windows acrescenta camadas, o motor do banco é outro). Compare a **proporção entre variantes dentro do mesmo banco**.
- **Se rodar o `nested` em PostgreSQL:** a divisão em 3 consultas (`AsSplitQuery`) custa 3 idas e voltas ao banco; num exemplo (300 iterações), REST 13,1 ms, BFF 2,6 ms e GraphQL 5,7 ms. A tendência é o GraphQL ficar entre o BFF e o REST de 7 requisições, mas confirme ao vivo e só compare dentro do mesmo banco.
- **Se algo falhar:** volte ao SQLite e siga ([plano B](#plano-b)).

## Bloco 7. Fechamento: a tese e a tabela de decisão (16:30 a 18:30)

**Voltar à pergunta inicial** ("GraphQL é mais rápido que REST?") e responder em quatro linhas, do resultado ao mecanismo:

| Cenário | O que se observou | Mecanismo |
|---|---|---|
| Consulta simples | REST menor ou igual | GraphQL paga parse, validação e execução da query |
| Over-fetching | GraphQL recebe muito menos bytes | O cliente declara os campos; o SELECT traz só as colunas pedidas |
| Relacionamentos | GraphQL e BFF fazem 1 requisição; REST de recursos faz 1+1+N | Under-fetching; mas 1 requisição só é rápida se o SQL por trás também for |
| N+1 | 51 contra 1 consulta SQL para a mesma tela | Quem decide é a estratégia do servidor, não o protocolo |

**A tese:** "Não existe tecnologia vencedora. O resultado **depende do padrão de acesso aos dados**: quantos recursos a tela costura, quanto do recurso ela usa, quanto custa cada ida à rede e como o servidor busca no banco."

**Tabela "quando usar cada um"** (projete ou deixe numa lâmina):

| Situação | Tende a favorecer | Por quê | Cuidados |
|---|---|---|---|
| Recursos simples e estáveis, leitura por identificador, muito reaproveitamento de cache (catálogos, CRUD) | REST | Menor custo por requisição; URI endereçável e cache HTTP; simplicidade | Over-fetching se o recurso for grande; versionar rota ou cabeçalho |
| Vários tipos de cliente (web, mobile, parceiros) com necessidades de campos diferentes e telas que mudam rápido | GraphQL | O cliente escolhe os campos; menos bytes; schema tipado como contrato | Custo de query, DataLoader ou projeção, cache mais difícil |
| Tela que costura vários recursos relacionados e rede cara ou lenta | GraphQL ou endpoint sob medida (BFF) | 1 requisição no lugar de 1+N | GraphQL: conferir o SQL gerado. BFF: um endpoint por tela, acoplamento |
| Tela estável, mesma equipe controla cliente e servidor, desempenho crítico | REST com BFF | Controle total da consulta e melhor resultado possível | Proliferação de endpoints |
| Comunicação interna entre serviços com alta vazão e contrato binário | gRPC (cap. 8; não medido aqui) | HTTP/2 com Protobuf, contrato `.proto` | Sem suporte nativo em navegadores (gRPC-Web); formato binário, menos legível |
| Notificação de eventos e mensageria confiável | Webhook ou AMQP (cap. 8) | Comunicação assíncrona (push ou filas): outro problema | Fora do escopo deste laboratório |
| API pública para terceiros desconhecidos | REST, ou GraphQL com governança | Custo previsível por endpoint contra flexibilidade que exige limites | Limites de profundidade e custo, paginação com teto, autenticação (não exercitados aqui) |

**Regra que vale para qualquer escolha:** meça o **número de consultas SQL por requisição**. N+1 e SQL ruim independem do protocolo.

**O que o experimento não diz:** custo em rede real, efeito de cache, segurança, custo operacional, gRPC, escrita (mutations) e eventos. É um experimento sobre padrões de acesso de leitura, não um veredito.

**Frase final:** "Meça o seu padrão de acesso. Olhe as contagens antes dos tempos."

**Bônus (só se o ensaio mostrar que cabe):** clique em "Executar todos os cenários" no início deste bloco e fale a tese enquanto roda; ao terminar, a seção 09 (Matriz-resumo) mostra todos os cenários lado a lado. Mantenha as mãos fora do mouse durante a execução.

## Perguntas prováveis da banca

**1. E o cache HTTP? Não favorece o REST?**
Sim, na prática. No REST, cada recurso tem uma URI e, em geral, `GET`; navegadores, proxies e CDNs cacheiam por URL com `Cache-Control` e `ETag`. Em GraphQL, quase tudo é `POST` para uma única URL, então o cache HTTP não se aplica por padrão. As saídas são consultas persistidas via `GET`, cache normalizado no cliente e DataLoader por requisição. O laboratório **não usa cache nenhum** (nem cabeçalhos de cache nem requisições condicionais), então mede o caminho até a origem; com cache, o REST em recursos populares pode ficar muito melhor.

**2. E o versionamento?**
No REST, versiona-se por rota (`/v2/...`) ou cabeçalho, ou evolui-se de forma aditiva. No GraphQL, o schema evolui de forma aditiva: acrescentar campo não quebra clientes, porque cada um pede explicitamente o que usa; remover exige marcar o campo como obsoleto e acompanhar o uso. Nenhum dos dois dispensa governança de contrato. O laboratório tem uma só versão.

**3. Segurança e custo de query: o cliente GraphQL não pode pedir uma query caríssima?**
Pode, e é um risco real do GraphQL: aninhamento profundo e listas multiplicam o custo (cliente, pedidos, itens, produto). Mitigações: limite de profundidade, análise de custo da query, paginação com teto, tempo limite, consultas persistidas, limite de taxa por custo e autorização por campo. No REST o custo é limitado pelo desenho de cada endpoint, mas também exige limite de taxa e paginação. **No laboratório não há autenticação, autorização nem limites de profundidade ou de custo configurados**; o `take` é limitado a 1.000 tanto no REST quanto no GraphQL, mas uma query aninhada com 1.000 itens ainda pode ser cara. É exatamente o tipo de ponto a tratar antes de ir para produção.

**4. N+1 é um problema do GraphQL?**
Não é do protocolo. É de como o servidor busca os dados. Ocorre em REST também, se o endpoint faz uma consulta por item. No GraphQL é mais fácil de cair, porque a execução é por campo. As defesas são DataLoader (lote), projeção (JOIN) ou consulta feita sob medida. Em qualquer caso, monitore o número de consultas SQL por requisição.

**5. Por que não incluíram gRPC?**
O capítulo 8 o posiciona para desempenho entre microsserviços (HTTP/2 e Protobuf) e ele não tem suporte nativo em navegadores. A pergunta do laboratório é outra: quem define o formato dos dados que uma tela consome (servidor ou cliente) e como isso afeta requisições, bytes e consultas. O gRPC muda o eixo de transporte e serialização; N+1 e over-fetching continuariam dependendo de como os métodos são desenhados. É uma extensão natural como trabalho futuro (uma terceira variante nos mesmos cenários).

**6. Os resultados são válidos? Dá para generalizar?**
Para **mecanismos e ordens de grandeza**, sim; para **valores absolutos**, não. As contagens (requisições, SQL, bytes, campos) são determinísticas e independentes da máquina. Os tempos valem para esta máquina e este momento. Ameaças reconhecidas (detalhadas no [README](README.md#7-limitações-e-ameaças-à-validade)): loopback sem rede real, HTTP/1.1 sem compressão nem cache, cliente e servidor no mesmo processo, SQLite in-process, dados sintéticos e pequenos, consulta sempre ao mesmo registro, CPU e memória do processo inteiro, e implementações que diferem além do protocolo. Mitigações: warm-up, cold à parte, blocos intercalados, percentis, repetição de runs.

**7. Por que o GraphQL aparece com 3 consultas SQL no cenário de relacionamentos, se é uma query só?**
Porque 1 requisição não é 1 consulta. O SQL gerado pela projeção automática do EF Core em uma consulta única tem subconsultas aninhadas que o SQLite materializa a cada execução (cerca de 5 ms; nessa forma o GraphQL perdia até para o REST de 7 requisições). O laboratório usa `AsSplitQuery`: cliente, pedidos e itens com produto em 3 consultas simples. No PostgreSQL a consulta única já era boa e a divisão custa 3 idas e voltas. É característica do SQL gerado e do banco, não do GraphQL, e a lição é olhar o SQL.

**8. Por que SQLite? Não deveria ser um banco de verdade?**
O padrão é SQLite para que qualquer pessoa rode sem instalar nada. Mas ele roda dentro do processo, o que disfarça o custo do N+1. Por isso existe o modo PostgreSQL opcional, em contêiner, com o mesmo seed, mesmas rotas e mesmas contagens de SQL; muda o custo de cada ida ao banco.

**9. E mutations e subscriptions?**
Fora do escopo: o laboratório mede leitura. As operações de escrita e de tempo real têm outras questões (consistência, transações, conexões persistentes).

**10. Posso usar os dois ao mesmo tempo?**
Pode, e é comum: este laboratório expõe REST e GraphQL sobre o mesmo contexto de dados. Um arranjo frequente é REST (ou endpoints sob medida) para integrações simples e públicas e GraphQL para clientes ricos, desde que haja governança.

## Plano B

| Se acontecer | Faça | Diga |
|---|---|---|
| Servidor não sobe porque a porta 5080 está ocupada | `netstat -ano \| findstr :5080` e `taskkill /PID <pid> /F` (Windows); ou suba com `-- --urls http://localhost:5090` e abra essa porta (a troca de porta foi exercitada, e o motor descobre o endereço do próprio servidor) | (nada; resolva antes de começar) |
| `dotnet` não encontra o SDK 9 | `dotnet --version`; instale o .NET 9 SDK | |
| Dashboard abre, mas o run falha ou trava | Botão **Cancelar**; ou "Acompanhar o run em andamento" se aparecer o aviso de conflito; reinicie o servidor se necessário | "Vou mostrar o resultado de uma execução anterior." |
| Execução ao vivo inviável | Seção **08 Histórico** e botão **Ver** reabrem um run anterior (ficam em memória: se o servidor reiniciou, somem). Alternativa: prints tirados no ensaio | "Estes números são de uma execução que fiz antes; o mecanismo é o mesmo." |
| Números ruidosos, empate inesperado ou outliers | Rode de novo com 1.000 ou mais iterações; feche outros programas; confira que ninguém mexe no navegador durante o run | Use o P99 para explicar a cauda; diferenças menores que 3% (ou que a dispersão medida) são empate técnico |
| GraphQL perde para o REST de 1+1+N no cenário de relacionamentos | Repita o run (ruído da máquina) e confira "Consultas SQL" = 3; se persistir, siga o roteiro: é uma lição, não um erro | Explique o SQL gerado (bloco 5.3) |
| Docker indisponível ou PostgreSQL não conecta | **Pule o bloco 6 e siga em SQLite**; o laboratório funciona integralmente sem Docker | "A contagem é a mesma: 51 contra 1 consulta. Com o banco em rede, cada uma pagaria uma ida e volta de rede; aqui já aparece mesmo com o banco em processo." |
| Abrir `/graphql` (IDE) falha | Mostre o schema em `/graphql?sdl` | |
| Projetor: texto pequeno ou contraste ruim | Zoom do navegador (`Ctrl` e `+`); botão "Tema escuro" ou "Tema claro" | |
| Sem internet | Não afeta: o dashboard não usa recursos externos | |

## Checklist pré-apresentação

**Dias antes**

- [ ] `dotnet --version` mostra 9.x e `dotnet build -c Release` termina sem erros.
- [ ] Ensaio completo cronometrado (versão 20 min e, se for o caso, 15 min). Anote quanto leva cada run de 1.000 iterações.
- [ ] Anote as medianas do ensaio de cada cenário. Se na hora os valores forem muito diferentes, algo está consumindo a máquina.
- [ ] Tire prints dos resultados de cada cenário (backup do plano B).
- [ ] Teste abrir `/graphql` sem internet. O HTML e o JavaScript do IDE (Nitro) são servidos pelo próprio servidor, sem CDN (conferido no HTML e no bundle principal), e a introspecção está habilitada, então o schema aparece; ainda assim, ensaie sem rede e tenha `/graphql?sdl` como alternativa.
- [ ] Se for usar o bloco 6: `docker compose up -d`, `docker compose ps` com `healthy`, servidor em modo PostgreSQL semeado uma vez, `nplus1` executado em ensaio. Decida entre as opções A e B de troca.
- [ ] Revise as perguntas da banca e o que foi (ou não foi) medido.

**No dia, antes de começar**

- [ ] Notebook na tomada e modo de energia de alto desempenho.
- [ ] Fechar aplicativos pesados e abas desnecessárias; silenciar notificações.
- [ ] Porta 5080 livre.
- [ ] Rodar em **Release**, fora do depurador: `dotnet run -c Release --project src/ApiBenchmark.Web`.
- [ ] Abrir `http://localhost:5080`; conferir a faixa de ambiente (contagens do banco, e o banco em uso se houver o campo).
- [ ] Decisão sobre o primeiro run: servidor recém-iniciado e sem pré-execução mostra o **cold run** de verdade no cenário `simple`; pré-executar tudo dá segurança, mas esconde esse momento. Escolha uma das duas e mantenha.
- [ ] Zoom e tema do navegador ajustados ao projetor.
- [ ] Configuração padrão no painel: 1.000 iterações, warm-up 50, concorrência 1.
- [ ] Este roteiro aberto num segundo monitor ou impresso; cronômetro visível.
- [ ] Combinar consigo mesmo: **não mexer no navegador durante um run**.

## Anexo. Exemplo de uma execução (somente ilustração)

Rodada de verificação em Windows, modo Release, concorrência 1, banco SQLite. Os valores abaixo **não são resultados fixos**: seus números serão diferentes. O que se espera preservar é o padrão relativo e, principalmente, as contagens.

**300 iterações, warm-up 50, processo recém-iniciado** (mediana em ms; bytes recebidos, requisições HTTP e consultas SQL por operação):

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

Outras observações da mesma máquina:

- `nested` com "REST em paralelo": REST 2,03 ms (ainda 7 requisições e 7 SQL); BFF 0,73 ms; GraphQL 1,28 ms.
- `nested` com concorrência 4: REST 3,87 ms, BFF 0,70 ms e GraphQL 1,08 ms.
- Campos JSON usados pela tela contra recebidos: `overfetching` REST 3 de 15, GraphQL 3 de 3; `overfetching-list` REST 150 de 750, GraphQL 150 de 150; `nested` REST 53 de 282, BFF e GraphQL 53 de 53; `nplus1` REST 200 de 500, GraphQL 200 de 200.

**Mesma bateria com o modo PostgreSQL** (300 iterações, warm-up 50, `Database:Provider=postgres`, contêiner local; contagens de SQL idênticas às do SQLite): `simple` REST 2,07 ms e GraphQL 2,70 ms; `overfetching` 2,14 e 1,97 ms; `overfetching-list` 3,33 e 2,18 ms; `nested` REST 13,09 ms, BFF 2,56 ms e GraphQL 5,71 ms; `nplus1` REST 2,39 ms, ingênuo 13,29 ms, DataLoader 4,69 ms e projeção 3,08 ms. Diferenças pequenas (como `overfetching`, 2,14 contra 1,97 ms) são empate técnico.

Os valores acima mudam de máquina para máquina e de rodada para rodada (nesta máquina, os mesmos cenários variam facilmente algumas dezenas de por cento entre execuções).

**Como usar estes valores no palco:** cite apenas como "exemplo de uma execução", sempre depois de mostrar os números ao vivo, e prefira falar de proporções e de contagens.
