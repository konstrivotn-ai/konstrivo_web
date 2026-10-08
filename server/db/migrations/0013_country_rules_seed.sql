-- PHASE 1 part 3 — TN seed rules mirror frontend countryConfig (data only).
INSERT INTO "country_calculation_rules" ("country_code","trade","rule_key","rule_value") VALUES
 ('TN', NULL, 'default_tva', '{"rate": 19}'),
 ('TN', NULL, 'timbre_fiscal', '{"amount": 1.0}'),
 ('TN', NULL, 'retenue_garantie', '{"rate": 5}'),
 ('TN', NULL, 'currency', '{"code": "TND"}'),
 ('TN', NULL, 'unit_system', '{"system": "metric"}')
ON CONFLICT DO NOTHING;
