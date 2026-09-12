// Configurações arquitetônicas padrão (em metros)
module.exports = {
  // Volumetria e Cortes Padrão
  wallHeight: 2.80,          // Pé-direito padrão da residência (2.80m)
  cutHeight: 1.30,           // Altura padrão do plano de corte para Planta Baixa 3D (1.30m)
  wallThickness: 0.15,       // Espessura padrão de parede executiva (15cm)
  exteriorWallThickness: 0.20, // Paredes externas / fachada (20cm)
  slabThickness: 0.12,       // Espessura da laje de piso/forro (12cm)

  // Portas
  doorWidth: 0.80,           // Largura padrão de porta interna (80cm)
  doorHeight: 2.10,          // Altura padrão de porta (2.10m)
  doorSill: 0.00,            // Peitoril de porta (0.00m)

  // Janelas (Corte e Esquadrias)
  windowWidth: 1.50,         // Largura padrão de janela
  windowHeight: 1.20,        // Altura padrão de janela (1.20m)
  windowSill: 1.00,          // Peitoril padrão (1.00m) - corta na planta baixa
  windowLintel: 2.20,        // Verga da janela (1.00m + 1.20m = 2.20m)

  // Janelas Altas (Banheiro / WC / Maxim-ar)
  bathWindowWidth: 0.80,     // Largura maxim-ar
  bathWindowHeight: 0.60,    // Altura maxim-ar
  bathWindowSill: 1.60,      // Peitoril alto (1.60m) - acima da linha de corte de 1.30m
  bathWindowLintel: 2.20,

  // Tolerâncias geométricas
  vertexSnapTolerance: 0.05, // 5cm de snap para vértices próximos
  parallelWallTolerance: 0.08 // 8cm para tolerância de alinhamento
};
