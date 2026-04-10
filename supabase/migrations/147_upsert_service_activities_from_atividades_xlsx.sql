-- 147_upsert_service_activities_from_atividades_xlsx.sql
-- Atualiza service_activities por code (description, group_name e type_service)
-- e insere codigos faltantes com defaults tecnicos para campos obrigatorios.
-- Origem: atividades.xlsx (Planilha1)
-- Observacao: quando um UUID de referencia nao existir no banco, o script resolve type_service pelo texto.

begin;

create temp table if not exists tmp_service_activities_import (
  code text not null,
  description text not null,
  group_name text,
  type_service_name text not null,
  type_service_id_ref uuid
) on commit drop;

truncate table tmp_service_activities_import;

insert into tmp_service_activities_import (code, description, group_name, type_service_name, type_service_id_ref)
values
  ('ABR103', 'ESCAVACAO NA ROCHA COM EQUIPAMENTO ESPECIAL', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO102', 'INSTALACAO DE ESTAI (REFORCO) EM POSTE MT/BT COM ALCAS (LARGAS E CURTAS)', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO103', 'RETIRO DE ESTAI (REFORCO) EM POSTE MT/BT COM ALCAS (LARGAS E CURTAS)', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO108', 'CONCRETAGEM DE CIMENTO PARA POSTES', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO110', 'INSTALACAO DE POSTE DE MT E ESTRUTURA', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO111', 'INSTALACAO DE POSTE DE BT E ESTRUTURA', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO112', 'INSTALACAO DE POSTE DE MT COM CONCRETO', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO113', 'INSTALACAO DE POSTE DE BT COM CONCRETO', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO132', 'TRANSPORTE MANUAL DE POSTES (SEM SER DE CONCRETO) E ACESSORIOS EM LUGARES SEM ACESSO A VEICULOS', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO133', 'ADICIONAL ESCAVACAO EM ROCHA COM COMPRESSOR', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO137', 'RETIRADA DE POSTE MT', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO138', 'RETIRADA DE POSTE BT', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO139', 'TRANSPORTE MANUAL DE POSTES EM CONCRETO E ACESSORIOS EM LUGARES SEM ACESSO A VEICULOS', 'SOT AEREA', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO804', 'INSTALACAO DE POSTE (DISPOSICAO PASSANTE) MT DE 10 A 15 METROS COM LINHA VIVA', 'LLEE', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO805', 'RETIRADA DE POSTE (DISPOSICAO PASSANTE) MT DE 10 A 15 METROS COM LINHA VIVA', 'LLEE', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO806', 'INSTALACAO DE POSTE DE MT DE 10 A 15 METROS OU ESTRUTURA DE ENCABECAMENTO C/ LINHA VIVA', 'LLEE', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('AHO807', 'RETIRADA DE POSTE DE MT DE 10 A 15 METROS OU ESTRUTURA DE ENCABECAMENTO C/ LINHA VIVA', 'LLEE', 'POSTE', '2a84dedc-5616-43a6-930d-847a1f05bc4c'::uuid),
  ('ABR115', 'INSTALACAO DE ESTRIBOS C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR116', 'RETIRADA DE ESTRIBOS C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR117', 'INSTALACAO EM SUBSTITUICAO DE ESTRIBOS E/OU REAJUSTE DE CONEXOES C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR118', 'RETIRADA EM SUBSTITUICAO DE ESTRIBOS E/OU REAJUSTE DE CONEXOES C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR119', 'INSTALACAO DE COBERTAS DE PROTECAO EM VAOS DE REDE', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR120', 'RETIRADA DE COBERTAS DE PROTECAO EM VAOS DE REDE', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR206', 'INSTALACAO DE ISOLADORES DE QUALQUER TIPO EM LINHA AEREA OU EM SUBESTACAO', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR207', 'RETIRADA DE ISOLADORES DE QUALQUER TIPO EM LINHA AEREA OU EM SUBESTACAO', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR241', 'INSTALACAO DE ISOLADORES DE QUALQUER TIPO EM LINHA AEREA OU EM SUBESTACAO EM SERVICO DE SUBSTITUICAO', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR508', 'INSTALACAO DE UM ISOLADOR DE PINO OU CADEIA EM REDE MT COM LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR509', 'INSTALACAO DE UM ISOLADOR DE PINO OU CADEIA COM LINHA VIVA EM SERVICO DE SUBSTITUICAO', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR510', 'RETIRADA DE UM ISOLADOR DE PINO OU CADEIA COM LINHA VIVA EM SERVICO DE SUBSTITUICAO', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO121', 'INSTALACAO DE CRUZETA SIMPLES OU DUPLA PARA CONDUTOR DESNUDO EM POSTE EXISTENTE', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO122', 'INSTALACAO DE CRUZETA SIMPLES OU DUPLA PARA CONDUTOR ISOLADO EM POSTE EXISTENTE', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO123', 'INSTALACAO ARMACAO SECUNDARIA (SIMPLES OU DUPLA)', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO124', 'RETIRADA DE CRUZETA SIMPLES OU DUPLA EM DISPOSICAO PASSANTE (INCLUINDO REDE COMPACTA)', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO125', 'RETIRADA DE CRUZETA SIMPLES OU DUPLA EM DISPOSICAO DE ENCABECAMENTO OU DERIVACAO', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO126', 'RETIRADA ARMACAO SECUNDARIA (SIMPLES OU DUPLA)', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO239', 'INSTALACAO OU SUBSTITUICAO DE ISOLADORES DE QUALQUER TIPO EM LINHA AEREA OU EM SUBESTACAO', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO240', 'RETIRADA DE ISOLADORES', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO812', 'INSTALACAO DE CRUZETA SIMPLES OU DUPLA EM DISPOSICAO PASSANTE C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO813', 'RETIRADA DE CRUZETA SIMPLES OU DUPLA EM DISPOSICAO PASSANTE C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO814', 'INSTALACAO DE CRUZETA SIMPLES OU DUPLA COM ENCABECAMENTO C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO815', 'INSTALACAO OU SUBSTITUICAO DE UM ISOLADOR DE PINO OU CADEIA COM LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO816', 'RETIRADA DE CRUZETA SIMPLES OU DUPLA COM ENCABECAMENTO COM LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('AHO820', 'INSTALACAO, RETIRADA OU CONSERTO DE ESTRIBOS E/OU REAJUSTE DE CONEXOES C/ LINHA VIVA', 'LLEE', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('FHO107', 'INSTALACAO DA ESTRUTURA E APARELHAGEM PARA UM TRANSFORMADOR EM UM POSTE', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('FHO112', 'RETIRADA DA ESTRUTURA E APARELHAGEM PARA UM TRANSFORMADOR EM UM POSTE', 'SOT AEREA', 'ESTRUTURA', '120985bd-6f46-4880-929c-f86ee3730768'::uuid),
  ('ABR515', 'RETIRADA DE CONECTOR AL/CU/AL-AL (TODAS AS SECOES) COM LINHA VIVA', 'LLEE', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO201', 'INSTALAR CONDUTORES DE 10 MM2 A 50 MM2 COBRE OU SEU EQUIVALENTE EM ALUMINIO.', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO202', 'INSTALAR REDE COM CONDUTORES DE 70 MM2 A 120 MM2 COBRE OU SEU EQUIVALENTE EM ALUMINIO.', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO203', 'INSTALAR REDE COM CONDUTORES ACIMA DE 120 MM2 COBRE OU SEU EQUIVALENTE EM ALUMINIO.', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO204', 'INSTALAR REDE COMPACTA (SPACE CAB) MT', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO205', 'INSTALACAO DE REDE TRANCADA EM MEDIA TENSAO', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO207', 'EXTENSAO PARA CLIENTE OU ILUMINACAO PUBLICA EM BT (SECAO SUPERIOR A 16MM2)', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO208', 'RETIRADA DE CONDUTOR DE 16 MM2 A 120 MM2 COBRE OU SEU EQUIVALENTE EM ALUMINIO.', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO210', 'RETIRA CONDUTOR OU CABOS MULTIPLEXADOS ACIMA DE 120 MM2 COBRE OU SEU EQUIVALENTE EM ALUMINIO.', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO211', 'RETIRADA DE CONDUTOR AEREO BT NU, MULTIPLEXADO OU ISOLADO DE QUALQUER CAPACIDADE', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO212', 'TENSIONAR OU SOLTAR CONDUTORES DE QUALQUER TIPO E DIMENSAO.', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO243', 'INSTALACAO DE CONDUTOR PRE REUNIDO DE BAIXA TENSAO (PR BT)', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO244', 'RETIRAR REDE COMPACTA (SPACE CAB) MT', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO256', 'RETIRADA DE REDE MULTIPLEXADA EM MT', 'SOT AEREA', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO818', 'LEVANTAR OU ABAIXAR REDES MT COM LINHA VIVA', 'LLEE', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO819', 'DESCONEXAO OU CONEXAO DE PONTES (BYPASS) DE MEDIA TENSAO COM LINHAS VIVAS', 'LLEE', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('AHO821', 'INSTALACAO DE CONECTOR AL/CU/AL-AL (TODAS AS SECOES) COM LINHA VIVA', 'LLEE', 'CONDUTOR(REDE)', '7340fb7e-d41b-41af-80ec-28cc5325a4ce'::uuid),
  ('ABR217', 'INSTALACAO DE UMA EMENDA EM MT (CABOS)', 'SOT AEREA', 'EMENDA', '7f6820c6-274e-4da9-a3d2-4360208fbf13'::uuid),
  ('ABR809', 'INSTALAR ESPACADORES EM MT E BT C/ LLEE', 'LLEE', 'EMENDA', '7f6820c6-274e-4da9-a3d2-4360208fbf13'::uuid),
  ('AHO215', 'INSTALACAO SUSTITUICAO OU RETIRADA DE UMA EMENDA EM BT (CABOS)', 'SOT AEREA', 'EMENDA', '7f6820c6-274e-4da9-a3d2-4360208fbf13'::uuid),
  ('AHO217', 'INSTALACAO DE UM SECCIONADOR OU RELIGADOR (SF6, OLEO, VAZIO) SEM CAIXA DE CONTROLE', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('AHO219', 'INSTALACAO DE PAINEL/CAIXA DE CONTROLE MONTADA EM POSTE', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('AHO220', 'RETIRADA DE UM SECIONALIZADOR OU RECONECTADOR (SF6, OLEO, VAZIO)', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('AHO327', 'RETIRADA DE PAINEL/CAIXA DE CONTROLE MONTADA EM POSTE', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('AHO336', 'ARRASTO MANUAL DE TRANSFOMADOR EM LUGAR SEM ACESSO PARA VEICULO.', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('AHO730', 'OPERACAO EM EQUIPAMENTOS DE DISTRIBUICAO AEREA MT', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('FHO110', 'INSTALACAO DE TRANSFORMADOR SOBRE POSTE (SOMENTE TRANSFORMADOR)', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('FHO115', 'RETIRADA DE TRANSFORMADOR SOBRE POSTE (SOMENTE TRANSFORMADOR)', 'SOT AEREA', 'EQUIPAMENTO', 'b0337482-f444-4b25-aa53-8fea7f743feb'::uuid),
  ('ABR316', 'INSTALACAO CHAVE FUSIVEL MT', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR511', 'CONEXAO DE PONTES (BYPASS) DE MEDIA TENSAO COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR512', 'DESCONEXAO DE PONTES (BYPASS) DE MEDIA TENSAO COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR513', 'CONEXAO DE PONTES (BYPASS) DE MEDIA TENSAO COM LINHA VIVA EM SUBSTITUICAO', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR514', 'DESCONEXAO DE PONTES (BYPASS) DE MEDIA TENSAO COM LINHA VIVA EM SUBSTITUICAO', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR516', 'INSTALACAO DE SENSOR - TC UNIPOLARES IMS - RGDAT COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR517', 'RETIRADA DE SENSOR - TC UNIPOLARES IMS - RGDAT COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR801', 'INSTALACAO DE CHAVE FACA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR802', 'RETIRADA DE CHAVE FACA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR805', 'INSTALACAO DE BANCO DE CONDENSADORES - TP-TC COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR806', 'RETIRADA DE BANCO DE CONDENSADORES - TP-TC COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO218', 'INSTALACAO DE UM SECIONADOR AEREO UNIPOLAR (LAMINAS, FUSIVEIS, CHAVE SECCIONADORA)', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO221', 'RETIRADA DE UM SECIONADOR AEREO UNIPOLAR (LAMINAS, FUSIVEIS, CHAVE SECCIONADORA)', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO222', 'INSTALACAO DE PARA-RAIOS', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO223', 'RETIRADA DE PARA-RAIOS', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO823', 'INSTALACAO DO EQUIPAMENTO DE PROTECAO MONOFASICA E PARARRAIO MT/BT C/ LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO824', 'RETIRADA DO EQUIPAMENTO DE PROTECAO MONOFASICA OU PARARRAIO MT/BT C/ LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO826', 'INSTALACAO OU RETIRADA DE BANCO DE CONDENSADORES - TP-TC COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('FBR102', 'INSTALACAO DE UM CONJUNTO DE FUSIVEIS MT', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('FBR104', 'INSTALACAO EM SUBSTITUICAO DE UM CONJUNTO DE FUSIVEIS MT', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('FBR106', 'RETIRADA EM SUBSTITUICAO DE CONJUNTO DE FUSIVEIS MT', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('FBR118', 'INSTALACAO DE BANCO DE CONDENSADORES TP-TC', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('FBR119', 'RETIRADA DE BANCO DE CONDENSADORES TP-TC', 'SOT AEREA', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('AHO828', 'INSTALACAO DE UM SECCIONADOR OU RELIGADOR (SF6, OLEO, VAZIO) SEM CAIXA DE CONTROLE COM LINHA VIVA', 'LLEE', 'MQS CHAVES/PARA-RAIO', '289ea1d8-dcc6-4ec0-a0a6-06620eed829c'::uuid),
  ('ABR236', 'REPRAROS E MELHORIA NOS CABOS DE ATERRAMENTO MT E BT', 'SOT AEREA', 'MANUTENCAO', '1e9b9262-e1cc-49d5-b7dd-9eb5e53049a5'::uuid),
  ('AHO127', 'INSTALACAO DE TIRANTE (VENTO, ANCORA)', 'SOT AEREA', 'MANUTENCAO', '1e9b9262-e1cc-49d5-b7dd-9eb5e53049a5'::uuid),
  ('AHO128', 'MANUTENCAO OU RETIRADA DE TIRANTE', 'SOT AEREA', 'MANUTENCAO', '1e9b9262-e1cc-49d5-b7dd-9eb5e53049a5'::uuid),
  ('FHO103', 'INSTALACAO OU MELHORIA DO ATERRAMENTO DE SERVICO OU DE PROTECAO', 'SOT AEREA', 'MANUTENCAO', '1e9b9262-e1cc-49d5-b7dd-9eb5e53049a5'::uuid),
  ('ABR204', 'INSTALACAO DA CAIXA DE PROTECAO OU DERIVACAO', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('ABR205', 'RETIRADA DA CAIXA DE PROTECAO OU DERIVACAO', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('ABR223', 'INSTALACAO DE CAIXA DE DISTRIBUICAO COM MUNCK', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('ABR224', 'RETIRADA DE CAIXA DE DISTRIBUICAO COM MUNCK', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('ABR243', 'INSTALACAO DA CAIXA DE PROTECAO OU DERIVACAO EM SERVICO DE SUBSTITUICAO', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('ABR244', 'RETIRADA DA CAIXA DE PROTECAO OU DERIVACAO EM SERVICO DE SUBSTITUICAO', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('AHO226', 'INSTALACAO SUBSTITUICAO OU RETIRADA DA CAIXA DE PROTECAO OU DERIVACAO', 'SOT AEREA', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('CHO501', 'INSTALACAO DE RAMAL AEREO BT MONOFASICO OU BIFASICO DE SECAO MENOR OU IGUAL A 36 MM2.', 'SOC', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('CHO504', 'INSTALACAO DE RAMAL AEREO BT TRIFASICO DE SECAO MENOR OU IGUAL A 36 MM2', 'SOC', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('CHO508', 'RETIRADA DE RAMAL AEREO BT', 'SOC', 'RAMAL / CAIXA DAE', '221028e1-bd2e-4ad6-802b-6812f4f8cc4b'::uuid),
  ('GHO101', 'APLICACAO DE GRUPO GERADOR MAIOR QUE 5KVA ATE 30 KVA', 'SOT AEREA', 'GERADOR', '3359dbb1-9586-49ee-9207-7d9adfbf8c41'::uuid),
  ('GHO105', 'ALIMENTACAO E FUNCIONAMENTO DE GRUPO GERADOR', 'SOT AEREA', 'GERADOR', '3359dbb1-9586-49ee-9207-7d9adfbf8c41'::uuid),
  ('GHO106', 'APLICACAO DE GRUPO GERADOR ATE 5 KVA', 'SOT AEREA', 'GERADOR', '3359dbb1-9586-49ee-9207-7d9adfbf8c41'::uuid),
  ('TBR117', 'CORTE DE BAMBU - COM RETIRADA DE RESIDUOS', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('TBR128', 'CORTE DE BAMBU - SEM RETIRADA DE RESIDUOS', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('TBR129', 'LIMPEZA DE FAIXA DE SERVIDAO EM TERRENO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('TBR132', 'PODA DE COQUEIROS, POR COQUEIRO PODADO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO102', 'PODA E/OU DESRAMIFICACAO DA AREA ARBORIZADA EM LINHA DE MEDIA TENSAO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO103', 'PODA E/OU DESRAMIFICACAO DE ARVORE ISOLADA EM LINHA DE MEDIA TENSAO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO105', 'CORTE DE ARVORE ISOLADA EM LINHA DE MEDIA TENSAO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO107', 'PODA E/OU DESRAMIFICACAO DA AREA ARBORIZADA EM LINHA DE MEDIA TENSAO SEM RETIRADA DE RESIDUOS', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO108', 'PODA E/OU DESRAMIFICACAO DE ARVORE ISOLADA EM LINHA DE MEDIA TENSAO SEM RETIRADA DE RESIDUOS', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO110', 'CORTE DE AREA ARBORIZADA PARA CONSTRUCAO DE NOVA LINHA DE MEIA TENSAO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO112', 'PODA E/OU DESRAMIFICACAO DE ARVORE ISOLADA EM LINHA DE BAIXA TENSAO', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('THO115', 'PODA E/OU DESRAMIFICACAO DE ARVORE ISOLADA EM LINHA DE BAIXA TENSAO SEM RETIRADA DE RESIDUOS', 'PODA', 'PODA', 'd50b5dd9-ba98-43d0-aa10-3f9d78cb7f22'::uuid),
  ('AHO717', 'INSPECAO PREVIA DE DESCARGOS REDES AEREAS (ZONAS DE DESCONEXAO PROGRAMADA)', 'SOT AEREA', 'OUTROS', 'a8896e4e-f791-4f34-8847-870af84e130a'::uuid),
  ('AHO720', 'ATUALIZACAO CARTOGRAFICA DA REDE', 'SOT AEREA', 'OUTROS', 'a8896e4e-f791-4f34-8847-870af84e130a'::uuid),
  ('AHO722', 'AVISO DE DESLIGAMENTO COM ASSINATURA', 'SOT AEREA', 'OUTROS', 'a8896e4e-f791-4f34-8847-870af84e130a'::uuid);

do $$
declare
  v_tenant_id uuid;
  v_distinct_tenants integer;
  v_missing_team_type integer;
  v_unresolved_types integer;
  v_unresolved_details text;
begin
  -- 1) Tenta inferir tenant pelos UUIDs de referencia que existem no banco.
  with tenant_candidates as (
    select distinct tsa.tenant_id
    from public.types_service_activities tsa
    join (
      select distinct src.type_service_id_ref
      from tmp_service_activities_import src
      where src.type_service_id_ref is not null
    ) src
      on src.type_service_id_ref = tsa.id
  )
  select
    count(*)::integer,
    (array_agg(tc.tenant_id order by tc.tenant_id))[1]
  into v_distinct_tenants, v_tenant_id
  from tenant_candidates tc;

  -- 2) Fallback: infere tenant pelos codigos ja existentes em service_activities.
  if v_tenant_id is null then
    with tenant_candidates as (
      select distinct sa.tenant_id
      from public.service_activities sa
      join (
        select distinct upper(btrim(code)) as code
        from tmp_service_activities_import
      ) src
        on src.code = upper(btrim(sa.code))
    )
    select
      count(*)::integer,
      (array_agg(tc.tenant_id order by tc.tenant_id))[1]
    into v_distinct_tenants, v_tenant_id
    from tenant_candidates tc;

    if v_distinct_tenants <> 1 then
      v_tenant_id := null;
    end if;
  end if;

  -- 3) Fallback final: usa tenant unico do ambiente, quando houver apenas 1.
  if v_tenant_id is null then
    with tenant_candidates as (
      select t.id as tenant_id
      from public.tenants t
    )
    select
      count(*)::integer,
      (array_agg(tc.tenant_id order by tc.tenant_id))[1]
    into v_distinct_tenants, v_tenant_id
    from tenant_candidates tc;

    if v_distinct_tenants <> 1 then
      raise exception 'Nao foi possivel inferir tenant automaticamente. Informe tenant unico no ambiente ou ajuste os UUIDs de referencia.';
    end if;
  end if;

  create temp table tmp_default_team_type on commit drop as
  select
    v_tenant_id as tenant_id,
    coalesce(
      (
        select tt.id
        from public.team_types tt
        where tt.tenant_id = v_tenant_id
          and upper(btrim(tt.name)) = 'PADRAO'
        order by tt.updated_at desc nulls last, tt.created_at desc nulls last
        limit 1
      ),
      (
        select tt.id
        from public.team_types tt
        where tt.tenant_id = v_tenant_id
          and tt.ativo = true
        order by tt.updated_at desc nulls last, tt.created_at desc nulls last
        limit 1
      ),
      (
        select tt.id
        from public.team_types tt
        where tt.tenant_id = v_tenant_id
        order by tt.updated_at desc nulls last, tt.created_at desc nulls last
        limit 1
      )
    ) as team_type_id;

  select count(*)
  into v_missing_team_type
  from tmp_default_team_type
  where team_type_id is null;

  if v_missing_team_type > 0 then
    raise exception 'Nao foi encontrado team_type para o tenant %.', v_tenant_id;
  end if;

  -- Resolve type_service priorizando UUID de referencia valido no tenant;
  -- se nao existir, resolve pelo nome textual normalizado.
  create temp table tmp_service_activities_resolved on commit drop as
  with src as (
    select
      upper(btrim(i.code)) as code,
      btrim(i.description) as description,
      nullif(btrim(i.group_name), '') as group_name,
      upper(btrim(i.type_service_name)) as type_service_name,
      i.type_service_id_ref
    from tmp_service_activities_import i
    where nullif(btrim(i.code), '') is not null
  ),
  src_ranked as (
    select
      s.*,
      row_number() over (
        partition by s.code
        order by s.code desc, s.description desc
      ) as rn
    from src s
  )
  select
    sr.code,
    sr.description,
    sr.group_name,
    coalesce(
      (
        select tsa.id
        from public.types_service_activities tsa
        where tsa.tenant_id = v_tenant_id
          and tsa.id = sr.type_service_id_ref
        limit 1
      ),
      (
        select tsa.id
        from public.types_service_activities tsa
        where tsa.tenant_id = v_tenant_id
          and regexp_replace(
            translate(
              upper(btrim(tsa.name)),
              U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
              'AAAAAEEEEIIIIOOOOOUUUUC'
            ),
            '[^A-Z0-9]+',
            '',
            'g'
          ) = regexp_replace(
            translate(
              upper(btrim(sr.type_service_name)),
              U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
              'AAAAAEEEEIIIIOOOOOUUUUC'
            ),
            '[^A-Z0-9]+',
            '',
            'g'
          )
        limit 1
      )
    ) as type_service_id
  from src_ranked sr
  where sr.rn = 1;

  select count(*)
  into v_unresolved_types
  from tmp_service_activities_resolved r
  where r.type_service_id is null;

  if v_unresolved_types > 0 then
    select string_agg(
      format('[code=%s, categoria=%s]', x.code, x.type_service_name),
      '; '
      order by x.code
    )
    into v_unresolved_details
    from (
      select distinct
        r.code,
        upper(btrim(i.type_service_name)) as type_service_name
      from tmp_service_activities_resolved r
      join tmp_service_activities_import i
        on upper(btrim(i.code)) = r.code
      where r.type_service_id is null
    ) x;

    raise exception
      'Existem % linhas sem type_service resolvido por UUID/nome. Detalhes: %',
      v_unresolved_types,
      coalesce(v_unresolved_details, 'sem detalhes');
  end if;

  insert into public.service_activities (
    tenant_id,
    code,
    description,
    team_type_id,
    type_service,
    group_name,
    unit_value,
    unit,
    scope,
    ativo
  )
  select
    dtt.tenant_id,
    r.code,
    r.description,
    dtt.team_type_id,
    r.type_service_id,
    r.group_name,
    0::numeric(14, 2) as unit_value,
    'UN'::text as unit,
    null::text as scope,
    true as ativo
  from tmp_service_activities_resolved r
  cross join tmp_default_team_type dtt
  on conflict (tenant_id, code) do update
  set
    description = excluded.description,
    type_service = excluded.type_service,
    group_name = excluded.group_name,
    updated_at = now();
end;
$$;

commit;
