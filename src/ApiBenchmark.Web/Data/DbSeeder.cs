using System.Data.Common;
using System.Globalization;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace ApiBenchmark.Web.Data;

public static class DbSeeder
{
    public const int CategoryCount = 20;
    public const int SupplierCount = 30;
    public const int BaseProductCount = 500;
    public const int DefaultProductTarget = 100_000;
    public const int ProductBatchSize = 5_000;
    public const int CustomerCount = 200;

    private const int ExtraProductsRandomSeed = 4242;
    private const string ProductColumns = "\"Id\", \"Name\", \"Description\", \"Price\", \"Stock\", \"Sku\", \"CreatedAt\", \"UpdatedAt\", \"CategoryId\", \"SupplierId\"";
    private static readonly DateTime ProductBaseDate = new(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private sealed record CategorySeed(string Name, string Description, string Noun, string[] Items, int MinPrice, int MaxPrice);

    private static readonly CategorySeed[] Categories =
    [
        new("Notebooks", "Notebooks para trabalho, estudo e jogos.", "Notebook", ["Dell Inspiron 15", "Lenovo IdeaPad 3", "Acer Aspire 5", "Samsung Galaxy Book2", "ASUS Vivobook 15", "HP Pavilion 14"], 2800, 9500),
        new("Smartphones", "Celulares e smartphones de todas as faixas de preço.", "Smartphone", ["Samsung Galaxy A54", "Motorola Moto G84", "Xiaomi Redmi Note 12", "Apple iPhone 13", "Realme C55", "Samsung Galaxy S23"], 900, 7500),
        new("Televisores", "Smart TVs e monitores de grande formato.", "Smart TV", ["LG UHD 50 polegadas", "Samsung Crystal 55 polegadas", "TCL P635 43 polegadas", "Philips 4K 58 polegadas", "Sony Bravia 65 polegadas", "AOC Roku 32 polegadas"], 1200, 8500),
        new("Áudio", "Fones de ouvido, caixas de som e soundbars.", "Fone de Ouvido", ["JBL Tune 510BT", "Sony WH-CH520", "Philips TAH4205", "Edifier W820NB", "Xiaomi Redmi Buds 4", "Logitech Zone Vibe"], 90, 900),
        new("Periféricos", "Teclados, mouses, monitores e acessórios para computador.", "Mouse Sem Fio", ["Logitech M170", "Logitech MX Master 3S", "Microsoft Bluetooth Ergonômico", "Razer DeathAdder", "Multilaser MO251", "HP 220"], 35, 480),
        new("Games", "Consoles, controles e acessórios para jogos.", "Controle", ["Sony DualSense", "Microsoft Xbox Series", "Nintendo Pro Controller", "8BitDo Pro 2", "Redragon Saturn", "Logitech F310"], 120, 650),
        new("Cozinha", "Eletrodomésticos e utensílios para cozinha.", "Air Fryer", ["Mondial 4 litros", "Philco Gourmet 5 litros", "Britânia Digital 7 litros", "Oster Dual 6 litros", "Electrolux Efficient 8 litros", "Cadence Família 4,5 litros"], 250, 1100),
        new("Casa e Limpeza", "Aspiradores, ventiladores e produtos para o lar.", "Aspirador de Pó", ["Electrolux Easybox", "Philco Ciclone", "Arno Clean Force", "Black+Decker Dustbuster", "Mondial Turbo", "WAP Ciclone 1400"], 150, 1500),
        new("Móveis", "Móveis para casa e escritório.", "Cadeira de Escritório", ["Flexform Presidente", "Cavaletti Ergonômica", "ThunderX3 Air", "Maxtec Executiva", "Pelegrin PEL-3003", "Mobly Rotativa"], 300, 1800),
        new("Ferramentas", "Ferramentas elétricas e manuais.", "Furadeira", ["Bosch GSB 13 RE", "Makita HP1630", "Black+Decker TM500", "Dewalt DWD115", "Tramontina 42517", "Vonder FVV 550"], 120, 1700),
        new("Esporte e Lazer", "Equipamentos esportivos e de lazer.", "Bicicleta Aro 29", ["Caloi Explorer", "Oggi Hacker Sport", "Specialized Rockhopper", "Sense Move", "Houston Foxer", "Track & Bike TB 300"], 900, 6800),
        new("Calçados", "Tênis, sandálias e calçados em geral.", "Tênis", ["Nike Revolution 6", "Adidas Duramo SL", "Olympikus Corre 3", "Mizuno Wave Falcon", "Asics Gel-Nimbus", "Fila Racer Curve"], 160, 900),
        new("Roupas", "Roupas masculinas e femininas.", "Camiseta", ["Hering Básica", "Malwee Dry Fit", "Reserva Pima", "Aramis Slim", "Colcci Estampada", "Lacoste Classic"], 40, 480),
        new("Beleza", "Perfumaria, cosméticos e cuidados pessoais.", "Perfume", ["Boticário Malbec", "Natura Kaiak", "Avon Far Away", "Eudora Niina Secrets", "O Boticário Egeo", "Natura Essencial"], 60, 520),
        new("Livros", "Livros técnicos, literatura e didáticos.", "Livro", ["Clean Code", "Domain-Driven Design", "Arquitetura Limpa", "Refatoração", "O Programador Pragmático", "Padrões de Projeto"], 45, 220),
        new("Brinquedos", "Brinquedos para todas as idades.", "Kit de Montar", ["LEGO City", "LEGO Technic", "Playmobil Aventura", "Mega Bloks Clássico", "Estrela Mini Cidade", "Xalingo Construtor"], 60, 1300),
        new("Papelaria", "Material escolar e de escritório.", "Caderno", ["Tilibra Espiral 200 folhas", "Foroni Universitário", "Credeal Brochura", "São Domingos Capa Dura", "Jandaia Criativo", "Fabriano Executivo"], 8, 60),
        new("Automotivo", "Acessórios e produtos para veículos.", "Pneu Aro 15", ["Pirelli Cinturato", "Michelin Energy", "Goodyear Assurance", "Bridgestone Turanza", "Continental ContiPower", "Dunlop Enasave"], 280, 1200),
        new("Pet Shop", "Produtos para cães, gatos e outros animais.", "Ração Premium", ["Golden Fórmula Adultos", "Premier Pet Raças Pequenas", "Royal Canin Mini", "Pedigree Vital Pro", "Whiskas Carne", "Biofresh Gatos Castrados"], 35, 380),
        new("Jardinagem", "Ferramentas e insumos para jardim.", "Cortador de Grama", ["Tramontina CE 1000", "Trapp RB 40", "Stihl RE 90", "Husqvarna LC 140", "Vonder CGV 1500", "Garthen 2000W"], 220, 2900),
    ];

    private static readonly string[] SkuPrefixes = Categories.Select(c => Slug(c.Name)[..3].ToUpperInvariant()).ToArray();

    private static readonly string[] Variants =
        ["", "", "", " Preto", " Branco", " Plus", " Pro", " Lite", " Edição 2024", " Compacto", " Premium", " Max", " Azul", " Prata"];

    private static readonly string[] DescriptionSentences =
    [
        "{0} foi projetado para oferecer desempenho consistente e confiável no uso diário.",
        "A linha {1} reúne produtos selecionados com foco em durabilidade e bom custo-benefício.",
        "Acabamento de alta qualidade, com materiais resistentes que garantem longa vida útil.",
        "Indicado tanto para uso doméstico quanto profissional, adaptando-se a diferentes rotinas.",
        "Acompanha manual em português, certificado de garantia e todos os acessórios necessários para o uso imediato.",
        "Conta com garantia do fabricante e suporte técnico especializado em todo o território nacional.",
        "Design moderno e funcional, pensado para se integrar com facilidade a qualquer ambiente.",
        "Passou por rigorosos testes de qualidade antes de chegar ao estoque, assegurando conformidade com as normas vigentes.",
        "Entrega rápida para todo o Brasil, com embalagem reforçada para proteger o produto durante o transporte.",
        "Excelente avaliação entre os clientes, que destacam a facilidade de uso e a ótima relação entre preço e desempenho.",
        "Eficiência energética e baixo ruído de funcionamento, contribuindo para a economia e o conforto no dia a dia.",
        "Compatível com os principais acessórios do mercado, o que facilita a expansão e a personalização conforme a necessidade.",
        "Oferece versatilidade para diferentes situações, seja no trabalho, nos estudos ou no tempo livre.",
        "Disponível para pronta entrega, com possibilidade de parcelamento e condições especiais para compras em quantidade.",
    ];

    private static readonly string[] SupplierPrefixes =
        ["Atlas", "Nova", "Prime", "Global", "Vértice", "Horizonte", "Aurora", "Central", "Delta", "Orion", "Pioneira", "Alfa", "Sul", "Norte", "Brasil"];
    private static readonly string[] SupplierSegments =
        ["Distribuidora", "Importadora", "Comércio", "Tecnologia", "Atacado", "Logística", "Suprimentos", "Indústria"];
    private static readonly string[] SupplierSuffixes = ["Ltda", "S.A.", "EIRELI", "ME"];
    private static readonly string[] Countries =
        ["Brasil", "Brasil", "Brasil", "China", "Estados Unidos", "Alemanha", "Japão", "Coreia do Sul", "Itália", "México", "Argentina", "Taiwan"];

    private static readonly string[] FirstNames =
    [
        "Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Karina", "Lucas", "Mariana", "Nicolas", "Olívia",
        "Pedro", "Rafaela", "Samuel", "Tatiane", "Vinícius", "Beatriz", "Caio", "Débora", "Eduardo", "Fernanda", "Gustavo", "Helena", "Igor", "Juliana", "Leonardo",
    ];
    private static readonly string[] LastNames =
    [
        "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida",
        "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas",
    ];
    private static readonly string[] Cities =
    [
        "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Porto Alegre", "Salvador", "Fortaleza", "Recife", "Brasília", "Manaus",
        "Goiânia", "Belém", "Florianópolis", "Vitória", "Campinas", "Natal", "Campo Grande", "João Pessoa", "Maceió", "Teresina",
    ];
    private static readonly string[] Statuses = ["Pendente", "Pago", "Enviado", "Entregue", "Cancelado"];

    public static int ResolveProductTarget(IConfiguration configuration)
    {
        var raw = configuration["Seed:Products"]?.Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return DefaultProductTarget;
        }

        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
        {
            throw new DatabaseSetupException($"Seed:Products inválido: '{raw}'. Informe um inteiro maior ou igual a {BaseProductCount}.");
        }

        if (value < BaseProductCount)
        {
            Console.WriteLine($"Seed:Products={value} abaixo do mínimo; usando {BaseProductCount}.");
            return BaseProductCount;
        }

        return value;
    }

    public static async Task<int> SeedAsync(LabDbContext db, int productTarget)
    {
        await db.Database.EnsureCreatedAsync();
        db.ChangeTracker.AutoDetectChangesEnabled = false;

        var inserted = 0;
        if (!await db.Products.AnyAsync())
        {
            await SeedBaseAsync(db);
            inserted += BaseProductCount;
        }

        return inserted + await CompleteProductsAsync(db, productTarget);
    }

    private static async Task SeedBaseAsync(LabDbContext db)
    {
        var rnd = new Random(42);

        var categories = new List<Category>(CategoryCount);
        for (var i = 0; i < CategoryCount; i++)
        {
            categories.Add(new Category { Id = i + 1, Name = Categories[i].Name, Description = Categories[i].Description });
        }

        var suppliers = new List<Supplier>(SupplierCount);
        for (var i = 1; i <= SupplierCount; i++)
        {
            var name = $"{Pick(rnd, SupplierPrefixes)} {Pick(rnd, SupplierSegments)} {Pick(rnd, SupplierSuffixes)}";
            var country = Pick(rnd, Countries);
            suppliers.Add(new Supplier
            {
                Id = i,
                Name = name,
                Country = country,
                ContactEmail = $"contato{i}@{Slug(name.Split(' ')[0])}{i}.com.br",
            });
        }

        var products = new List<Product>(BaseProductCount);
        for (var i = 1; i <= BaseProductCount; i++)
        {
            products.Add(BuildProduct(rnd, i));
        }

        var customers = new List<Customer>(CustomerCount);
        for (var i = 1; i <= CustomerCount; i++)
        {
            var first = Pick(rnd, FirstNames);
            var last = Pick(rnd, LastNames);
            customers.Add(new Customer
            {
                Id = i,
                Name = $"{first} {last}",
                Email = $"{Slug(first)}.{Slug(last)}{i}@exemplo.com.br",
                City = Pick(rnd, Cities),
                CreatedAt = new DateTime(2023, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(rnd.Next(0, 365)).AddMinutes(rnd.Next(0, 1440)),
            });
        }

        var orders = new List<Order>(CustomerCount * 5);
        var items = new List<OrderItem>(CustomerCount * 5 * 4);
        var orderStart = new DateTime(2024, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        var orderId = 0;
        var itemId = 0;
        foreach (var customer in customers)
        {
            var orderCount = rnd.Next(3, 7);
            for (var o = 0; o < orderCount; o++)
            {
                orderId++;
                var itemCount = rnd.Next(2, 6);
                var total = 0m;
                var used = new HashSet<int>();
                for (var k = 0; k < itemCount; k++)
                {
                    int productId;
                    do { productId = rnd.Next(1, BaseProductCount + 1); } while (!used.Add(productId));
                    var quantity = rnd.Next(1, 6);
                    var unitPrice = products[productId - 1].Price;
                    total += quantity * unitPrice;
                    itemId++;
                    items.Add(new OrderItem { Id = itemId, OrderId = orderId, ProductId = productId, Quantity = quantity, UnitPrice = unitPrice });
                }

                orders.Add(new Order
                {
                    Id = orderId,
                    CustomerId = customer.Id,
                    Date = orderStart.AddDays(rnd.Next(0, 480)).AddMinutes(rnd.Next(0, 1440)),
                    Total = total,
                    Status = Pick(rnd, Statuses),
                });
            }
        }

        await using var transaction = await db.Database.BeginTransactionAsync();

        db.Categories.AddRange(categories);
        db.Suppliers.AddRange(suppliers);
        db.Customers.AddRange(customers);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        db.Products.AddRange(products);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        db.Orders.AddRange(orders);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        db.OrderItems.AddRange(items);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        if (db.Database.IsNpgsql())
        {
            await AlignIdentitySequencesAsync(db);
        }

        await transaction.CommitAsync();
    }

    // Produtos 501..N saem de um Random(4242) próprio, em sequência: o produto N é sempre o mesmo, independentemente de onde a execução parou.
    // Para retomar, o fluxo é regerado desde o início e só os ids ausentes são inseridos (cada lote é uma transação).
    private static async Task<int> CompleteProductsAsync(LabDbContext db, int target)
    {
        var existing = await db.Products.CountAsync();
        if (existing >= target)
        {
            return 0;
        }

        Console.WriteLine($"Completando produtos: {existing} -> {target} (lotes de {ProductBatchSize})...");

        var firstMissingId = Math.Max(await db.Products.MaxAsync(p => p.Id), BaseProductCount) + 1;
        var skipForeignKeyChecks = db.Database.IsNpgsql() && await IsPostgresSuperuserAsync(db);
        var rnd = new Random(ExtraProductsRandomSeed);
        var batch = new List<Product>(ProductBatchSize);
        var inserted = 0;
        for (var id = BaseProductCount + 1; id <= target; id++)
        {
            var product = BuildProduct(rnd, id);
            if (id >= firstMissingId)
            {
                batch.Add(product);
            }

            if (batch.Count == ProductBatchSize || (id == target && batch.Count > 0))
            {
                await InsertProductBatchAsync(db, batch, skipForeignKeyChecks);
                inserted += batch.Count;
                batch.Clear();
            }
        }

        return inserted;
    }

    // Carga em massa fora do pipeline de SaveChanges do EF (um INSERT por linha: ~18 s no SQLite e ~34 s no PostgreSQL para 100 mil produtos).
    // Usa a mesma conexão e a mesma transação do EF; as colunas recebem os mesmos valores CLR que o EF enviaria.
    private static async Task InsertProductBatchAsync(LabDbContext db, List<Product> batch, bool skipForeignKeyChecks)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var connection = db.Database.GetDbConnection();
        if (db.Database.IsNpgsql())
        {
            if (skipForeignKeyChecks)
            {
                await db.Database.ExecuteSqlRawAsync("SET LOCAL session_replication_role = replica");
            }

            await CopyProductsAsync((NpgsqlConnection)connection, batch);
            await AlignProductSequenceAsync(db);
        }
        else
        {
            InsertProductsSqlite((SqliteConnection)connection, (SqliteTransaction)transaction.GetDbTransaction(), batch);
        }

        await transaction.CommitAsync();
    }

    // As FKs dos produtos gerados valem por construção (categorias 1..20, fornecedores 1..30). No PostgreSQL, validar linha a linha
    // custa ~7 s de 100 mil; o superusuário do contêiner de laboratório pode pular os gatilhos de FK só dentro da transação do lote.
    private static Task<bool> IsPostgresSuperuserAsync(LabDbContext db) => db.Database
        .SqlQueryRaw<bool>("SELECT rolsuper AS \"Value\" FROM pg_roles WHERE rolname = current_user")
        .SingleAsync();

    private static void InsertProductsSqlite(SqliteConnection connection, SqliteTransaction transaction, List<Product> batch)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"INSERT INTO \"Products\" ({ProductColumns}) VALUES ($id, $name, $description, $price, $stock, $sku, $createdAt, $updatedAt, $categoryId, $supplierId)";
        var id = AddParameter(command, "$id");
        var name = AddParameter(command, "$name");
        var description = AddParameter(command, "$description");
        var price = AddParameter(command, "$price");
        var stock = AddParameter(command, "$stock");
        var sku = AddParameter(command, "$sku");
        var createdAt = AddParameter(command, "$createdAt");
        var updatedAt = AddParameter(command, "$updatedAt");
        var categoryId = AddParameter(command, "$categoryId");
        var supplierId = AddParameter(command, "$supplierId");
        foreach (var product in batch)
        {
            id.Value = product.Id;
            name.Value = product.Name;
            description.Value = product.Description;
            price.Value = product.Price;
            stock.Value = product.Stock;
            sku.Value = product.Sku;
            createdAt.Value = product.CreatedAt;
            updatedAt.Value = product.UpdatedAt;
            categoryId.Value = product.CategoryId;
            supplierId.Value = product.SupplierId;
            command.ExecuteNonQuery();
        }
    }

    private static SqliteParameter AddParameter(SqliteCommand command, string name)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        command.Parameters.Add(parameter);
        return parameter;
    }

    private static async Task CopyProductsAsync(NpgsqlConnection connection, List<Product> batch)
    {
        await using var writer = await connection.BeginBinaryImportAsync($"COPY \"Products\" ({ProductColumns}) FROM STDIN (FORMAT BINARY)");
        foreach (var product in batch)
        {
            await writer.StartRowAsync();
            await writer.WriteAsync(product.Id, NpgsqlDbType.Integer);
            await writer.WriteAsync(product.Name, NpgsqlDbType.Text);
            await writer.WriteAsync(product.Description, NpgsqlDbType.Text);
            await writer.WriteAsync(product.Price, NpgsqlDbType.Numeric);
            await writer.WriteAsync(product.Stock, NpgsqlDbType.Integer);
            await writer.WriteAsync(product.Sku, NpgsqlDbType.Text);
            await writer.WriteAsync(product.CreatedAt, NpgsqlDbType.TimestampTz);
            await writer.WriteAsync(product.UpdatedAt, NpgsqlDbType.TimestampTz);
            await writer.WriteAsync(product.CategoryId, NpgsqlDbType.Integer);
            await writer.WriteAsync(product.SupplierId, NpgsqlDbType.Integer);
        }

        await writer.CompleteAsync();
    }

    private static Product BuildProduct(Random rnd, int id)
    {
        var catIndex = rnd.Next(CategoryCount);
        var seed = Categories[catIndex];
        var name = $"{seed.Noun} {Pick(rnd, seed.Items)}{Pick(rnd, Variants)}";
        var created = ProductBaseDate.AddDays(rnd.Next(0, 365)).AddMinutes(rnd.Next(0, 1440));
        return new Product
        {
            Id = id,
            Name = name,
            Description = BuildDescription(rnd, name, seed.Name),
            Price = Math.Round(seed.MinPrice + (decimal)rnd.NextDouble() * (seed.MaxPrice - seed.MinPrice), 0) - 0.01m,
            Stock = rnd.Next(0, 200),
            Sku = $"{SkuPrefixes[catIndex]}-{id:D5}-{rnd.Next(100, 999)}",
            CreatedAt = created,
            UpdatedAt = created.AddDays(rnd.Next(0, 300)),
            CategoryId = catIndex + 1,
            SupplierId = rnd.Next(1, SupplierCount + 1),
        };
    }

    // Os IDs do seed são explícitos; no PostgreSQL isso não avança a sequence da coluna identity.
    private static Task<int> AlignIdentitySequencesAsync(LabDbContext db) => db.Database.ExecuteSqlRawAsync(
        """
        SELECT
          setval(pg_get_serial_sequence('"Categories"', 'Id'), (SELECT MAX("Id") FROM "Categories")),
          setval(pg_get_serial_sequence('"Suppliers"', 'Id'), (SELECT MAX("Id") FROM "Suppliers")),
          setval(pg_get_serial_sequence('"Products"', 'Id'), (SELECT MAX("Id") FROM "Products")),
          setval(pg_get_serial_sequence('"Customers"', 'Id'), (SELECT MAX("Id") FROM "Customers")),
          setval(pg_get_serial_sequence('"Orders"', 'Id'), (SELECT MAX("Id") FROM "Orders")),
          setval(pg_get_serial_sequence('"OrderItems"', 'Id'), (SELECT MAX("Id") FROM "OrderItems"))
        """);

    private static Task<int> AlignProductSequenceAsync(LabDbContext db) => db.Database.ExecuteSqlRawAsync(
        """SELECT setval(pg_get_serial_sequence('"Products"', 'Id'), (SELECT MAX("Id") FROM "Products"))""");

    private static T Pick<T>(Random rnd, T[] values) => values[rnd.Next(values.Length)];

    private static string BuildDescription(Random rnd, string name, string category)
    {
        var sb = new StringBuilder();
        var used = new HashSet<int>();
        while (sb.Length < 380)
        {
            int idx;
            do { idx = rnd.Next(DescriptionSentences.Length); } while (!used.Add(idx));
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(string.Format(CultureInfo.InvariantCulture, DescriptionSentences[idx], name, category));
        }

        return sb.ToString();
    }

    private static string Slug(string text)
    {
        var normalized = text.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(ch)) sb.Append(char.ToLowerInvariant(ch));
        }

        return sb.ToString();
    }
}
