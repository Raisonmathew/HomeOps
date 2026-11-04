-- ============================================================================
-- HomeOps Pilot Catalog Seed (Plumbing, Electrical, AC repair)
-- ============================================================================

-- Categories
INSERT INTO service_categories (id, name, description, active, display_order)
VALUES 
    ('c1111111-1111-1111-1111-111111111111', 'Plumbing', 'Pipes, taps, drains, fixtures, and water motors', TRUE, 1),
    ('c2222222-2222-2222-2222-222222222222', 'Electrical', 'Switches, wiring, lighting, power tripping, and appliance connections', TRUE, 2),
    ('c3333333-3333-3333-3333-333333333333', 'AC Repair', 'Air conditioning servicing, cooling diagnosis, leaks, and installation', TRUE, 3)
ON CONFLICT (name) DO NOTHING;

-- Issue Types: Plumbing
INSERT INTO issue_types (service_category_id, name, description, required_skill_code, urgency_level, safety_message, active)
VALUES
    ('c1111111-1111-1111-1111-111111111111', 'Tap and fixture leakage', 'Leaking taps, mixer units, or shower heads', 'PLUMB_TAP', 'NORMAL', NULL, TRUE),
    ('c1111111-1111-1111-1111-111111111111', 'Pipe leakage or burst', 'Concealed or exposed water pipe leakages', 'PLUMB_PIPE', 'HIGH', 'Turn off the main water valve immediately if the water flow is severe.', TRUE),
    ('c1111111-1111-1111-1111-111111111111', 'Drain blockage', 'Blocked kitchen sink, bathroom drain, or toilet', 'PLUMB_DRAIN', 'NORMAL', NULL, TRUE),
    ('c1111111-1111-1111-1111-111111111111', 'Water motor / pump issue', 'Motor not pumping water or making excessive noise', 'PLUMB_MOTOR', 'NORMAL', NULL, TRUE)
ON CONFLICT (service_category_id, name) DO NOTHING;

-- Issue Types: Electrical
INSERT INTO issue_types (service_category_id, name, description, required_skill_code, urgency_level, safety_message, active)
VALUES
    ('c2222222-2222-2222-2222-222222222222', 'Switch and socket repair', 'Faulty wall switches, plug sockets, or regulators', 'ELEC_SWITCH', 'NORMAL', NULL, TRUE),
    ('c2222222-2222-2222-2222-222222222222', 'Lighting & fan installation', 'Tube lights, chandeliers, exhaust fans, ceiling fans', 'ELEC_LIGHT', 'NORMAL', NULL, TRUE),
    ('c2222222-2222-2222-2222-222222222222', 'Power tripping / Outage / Sparks', 'Frequent MCB trip or sparking sockets', 'ELEC_TRIP', 'CRITICAL', 'Electrical hazard reported. Do not touch affected equipment. Switch off the relevant circuit breaker if it is safe to do so.', TRUE),
    ('c2222222-2222-2222-2222-222222222222', 'Appliance power connection', 'Heavy appliance connection for geysers, ovens, or ACs', 'ELEC_APPLIANCE', 'NORMAL', NULL, TRUE)
ON CONFLICT (service_category_id, name) DO NOTHING;

-- Issue Types: AC Repair
INSERT INTO issue_types (service_category_id, name, description, required_skill_code, urgency_level, safety_message, active)
VALUES
    ('c3333333-3333-3333-3333-333333333333', 'AC cleaning & servicing', 'Routine filter cleaning and coil wash', 'AC_CLEAN', 'NORMAL', NULL, TRUE),
    ('c3333333-3333-3333-3333-333333333333', 'AC not cooling', 'Warm air blowing, gas recharge, or compressor issues', 'AC_COOLING', 'NORMAL', NULL, TRUE),
    ('c3333333-3333-3333-3333-333333333333', 'Water leakage from indoor unit', 'Water dripping inside the room from the split unit', 'AC_LEAK', 'NORMAL', NULL, TRUE),
    ('c3333333-3333-3333-3333-333333333333', 'AC installation / uninstallation', 'Shifting or mounting indoor/outdoor units', 'AC_INSTALL', 'NORMAL', NULL, TRUE)
ON CONFLICT (service_category_id, name) DO NOTHING;
