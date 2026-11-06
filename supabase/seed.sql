-- ============================================================================
-- HomeOps Pilot Catalog Seed (Plumbing, Electrical, AC repair)
-- IDs are random (column default); issue types find their category by name.
-- ============================================================================

-- Categories
INSERT INTO service_categories (name, description, active, display_order)
VALUES
    ('Plumbing', 'Pipes, taps, drains, fixtures, and water motors', TRUE, 1),
    ('Electrical', 'Switches, wiring, lighting, power tripping, and appliance connections', TRUE, 2),
    ('AC Repair', 'Air conditioning servicing, cooling diagnosis, leaks, and installation', TRUE, 3)
ON CONFLICT (name) DO NOTHING;

-- Issue Types
INSERT INTO issue_types (service_category_id, name, required_skill_code, urgency_level, safety_message, active)
SELECT c.id, v.name, v.skill, v.urgency::urgency_level, v.safety, TRUE
FROM (VALUES
    -- Plumbing
    ('Plumbing', 'Tap and fixture leakage', 'PLUMB_TAP', 'NORMAL', NULL),
    ('Plumbing', 'Pipe leakage or burst', 'PLUMB_PIPE', 'PRIORITY', 'Turn off the main water valve immediately if the water flow is severe.'),
    ('Plumbing', 'Drain blockage', 'PLUMB_DRAIN', 'NORMAL', NULL),
    ('Plumbing', 'Water motor / pump issue', 'PLUMB_MOTOR', 'NORMAL', NULL),
    -- Electrical
    ('Electrical', 'Switch and socket repair', 'ELEC_SWITCH', 'NORMAL', NULL),
    ('Electrical', 'Lighting & fan installation', 'ELEC_LIGHT', 'NORMAL', NULL),
    ('Electrical', 'Power tripping / Outage / Sparks', 'ELEC_TRIP', 'SAFETY_CRITICAL', 'Electrical hazard reported. Do not touch affected equipment. Switch off the relevant circuit breaker if it is safe to do so.'),
    ('Electrical', 'Appliance power connection', 'ELEC_APPLIANCE', 'NORMAL', NULL),
    -- AC Repair
    ('AC Repair', 'AC cleaning & servicing', 'AC_CLEAN', 'NORMAL', NULL),
    ('AC Repair', 'AC not cooling', 'AC_COOLING', 'NORMAL', NULL),
    ('AC Repair', 'Water leakage from indoor unit', 'AC_LEAK', 'NORMAL', NULL),
    ('AC Repair', 'AC installation / uninstallation', 'AC_INSTALL', 'NORMAL', NULL)
) AS v(category, name, skill, urgency, safety)
JOIN service_categories c ON c.name = v.category
ON CONFLICT (service_category_id, name) DO NOTHING;
