-- ============================================================================
-- HomeOps Migration 00001: Initial Canonical Schema (v1.1)
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Canonical Enums (Spec v1.1)
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('CUSTOMER', 'TECHNICIAN', 'OPERATOR', 'ADMIN');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'DELETED');
CREATE TYPE verification_status AS ENUM ('APPLIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE probation_status AS ENUM ('NOT_STARTED', 'ACTIVE', 'COMPLETED');
CREATE TYPE skill_approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE availability_status AS ENUM ('ONLINE', 'OFFLINE', 'BUSY', 'EXPIRED');
CREATE TYPE location_source AS ENUM ('BASE_LOCATION', 'CURRENT_SHARED_LOCATION', 'TELEGRAM', 'MANUAL', 'OPERATOR_CORRECTED');
CREATE TYPE urgency_level AS ENUM ('NORMAL', 'PRIORITY', 'SAFETY_CRITICAL');
CREATE TYPE phone_number_source AS ENUM ('SHARED_CONTACT', 'MANUAL', 'OPERATOR_VERIFIED');
CREATE TYPE batch_progression_status AS ENUM ('IDLE', 'PROCESSING');
CREATE TYPE relay_status AS ENUM ('ACTIVE', 'CLOSED', 'BLOCKED');
CREATE TYPE storage_reason AS ENUM ('VERIFICATION', 'COMPLAINT', 'ESSENTIAL_EVIDENCE');
CREATE TYPE processing_result AS ENUM ('SUCCESS', 'IGNORED', 'FAILED');

CREATE TYPE request_status AS ENUM (
    'DRAFT',
    'REQUESTED',
    'SEARCHING',
    'ASSIGNED',
    'CONTACTED',
    'DISCUSSING_SCOPE',
    'AGREED',
    'IN_PROGRESS',
    'TECHNICIAN_MARKED_COMPLETE',
    'CUSTOMER_CONFIRMATION_PENDING',
    'COMPLETED',
    'PARTIALLY_COMPLETED',
    'UNABLE_TO_COMPLETE',
    'DISPUTED',
    'EXPIRED',
    'NO_TECHNICIAN_FOUND',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_TECHNICIAN',
    'CANCELLED_BY_OPERATOR'
);

CREATE TYPE offer_status AS ENUM (
    'SENT',
    'VIEWED',
    'ACCEPTED',
    'DECLINED',
    'EXPIRED',
    'LOST_TO_ANOTHER_TECHNICIAN',
    'CANCELLED'
);

CREATE TYPE customer_acknowledgement_status AS ENUM (
    'NOT_REVIEWED',
    'ACKNOWLEDGED',
    'DISPUTED'
);

CREATE TYPE attachment_type AS ENUM (
    'ISSUE_PHOTO',
    'BEFORE_PHOTO',
    'AFTER_PHOTO',
    'COMPLAINT_EVIDENCE',
    'VERIFICATION_DOCUMENT'
);

CREATE TYPE complaint_status AS ENUM (
    'OPEN',
    'CUSTOMER_CONTACTED',
    'TECHNICIAN_CONTACTED',
    'UNDER_REVIEW',
    'RESOLVED',
    'ACCOUNT_ACTION_TAKEN'
);

-- ----------------------------------------------------------------------------
-- Core Identity Tables
-- ----------------------------------------------------------------------------
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_user_id BIGINT UNIQUE NOT NULL,
    telegram_username TEXT,
    role user_role NOT NULL DEFAULT 'CUSTOMER',
    full_name TEXT NOT NULL,
    phone_number TEXT,
    phone_number_source phone_number_source,
    allow_direct_contact_after_assignment BOOLEAN NOT NULL DEFAULT TRUE,
    account_status account_status NOT NULL DEFAULT 'ACTIVE',
    accepted_terms_version TEXT DEFAULT 'v1.0',
    accepted_terms_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE operator_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    supabase_auth_user_id UUID UNIQUE,
    operator_role user_role NOT NULL DEFAULT 'OPERATOR',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Technician Tables
-- ----------------------------------------------------------------------------
CREATE TABLE technician_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    verification_status verification_status NOT NULL DEFAULT 'APPLIED',
    experience_years INT DEFAULT 0,
    profile_summary TEXT,
    base_latitude NUMERIC(10, 6),
    base_longitude NUMERIC(10, 6),
    default_radius_km NUMERIC(5, 2) NOT NULL DEFAULT 8.0,
    preferred_travel_minutes INT DEFAULT 30,
    accepts_extended_distance BOOLEAN NOT NULL DEFAULT FALSE,
    average_rating NUMERIC(3, 2) NOT NULL DEFAULT 0.0,
    completed_request_count INT NOT NULL DEFAULT 0,
    acceptance_rate NUMERIC(5, 4) NOT NULL DEFAULT 1.0,
    completion_rate NUMERIC(5, 4) NOT NULL DEFAULT 1.0,
    post_acceptance_cancellation_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0,
    complaint_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0,
    probation_status probation_status NOT NULL DEFAULT 'NOT_STARTED',
    last_offered_at TIMESTAMPTZ,
    recent_offer_count_7d INT NOT NULL DEFAULT 0,
    recent_assignment_count_30d INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE service_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0
);

CREATE TABLE issue_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    required_skill_code TEXT NOT NULL,
    urgency_level urgency_level NOT NULL DEFAULT 'NORMAL',
    safety_message TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_category_issue_name UNIQUE (service_category_id, name)
);

CREATE TABLE technician_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technician_profiles(id) ON DELETE CASCADE,
    service_category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    issue_type_id UUID REFERENCES issue_types(id) ON DELETE CASCADE,
    approval_status skill_approval_status NOT NULL DEFAULT 'PENDING',
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    CONSTRAINT uq_technician_skill UNIQUE (technician_id, service_category_id, issue_type_id)
);

CREATE TABLE technician_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technician_profiles(id) ON DELETE CASCADE,
    availability_status availability_status NOT NULL DEFAULT 'OFFLINE',
    location_source location_source NOT NULL DEFAULT 'BASE_LOCATION',
    current_latitude NUMERIC(10, 6) NOT NULL,
    current_longitude NUMERIC(10, 6) NOT NULL,
    effective_radius_km NUMERIC(5, 2) NOT NULL DEFAULT 8.0,
    available_from TIMESTAMPTZ NOT NULL,
    available_until TIMESTAMPTZ NOT NULL,
    location_updated_at TIMESTAMPTZ NOT NULL,
    location_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Customer Tables
-- ----------------------------------------------------------------------------
CREATE TABLE customer_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    address_text TEXT,
    latitude NUMERIC(10, 6) NOT NULL,
    longitude NUMERIC(10, 6) NOT NULL,
    location_source location_source NOT NULL DEFAULT 'TELEGRAM',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Request & Offer Tables
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS request_number_seq START 1001;

CREATE TABLE service_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_number TEXT UNIQUE NOT NULL DEFAULT ('REQ-' || nextval('request_number_seq')::TEXT),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    assigned_technician_id UUID REFERENCES technician_profiles(id) ON DELETE SET NULL,
    service_category_id UUID NOT NULL REFERENCES service_categories(id),
    issue_type_id UUID NOT NULL REFERENCES issue_types(id),
    description TEXT NOT NULL,
    service_address_text TEXT,
    service_latitude NUMERIC(10, 6) NOT NULL,
    service_longitude NUMERIC(10, 6) NOT NULL,
    preferred_start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    preferred_end_time TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
    urgency urgency_level NOT NULL DEFAULT 'NORMAL',
    status request_status NOT NULL DEFAULT 'DRAFT',
    current_offer_batch INT NOT NULL DEFAULT 0,
    batch_progression_status batch_progression_status NOT NULL DEFAULT 'IDLE',
    batch_progression_claimed_at TIMESTAMPTZ,
    operator_review_required BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_started_at TIMESTAMPTZ,
    assigned_at TIMESTAMPTZ,
    work_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE request_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES technician_profiles(id) ON DELETE CASCADE,
    distance_km NUMERIC(6, 2) NOT NULL,
    technician_radius_km NUMERIC(5, 2) NOT NULL,
    match_score NUMERIC(5, 2) NOT NULL,
    match_explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
    offer_batch INT NOT NULL DEFAULT 1,
    offer_status offer_status NOT NULL DEFAULT 'SENT',
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    viewed_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_request_tech_offer UNIQUE (service_request_id, technician_id)
);

CREATE TABLE request_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    performed_by UUID REFERENCES profiles(id),
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Relay & Marketplace Record Tables
-- ----------------------------------------------------------------------------
CREATE TABLE assignment_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID UNIQUE NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    relay_status relay_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE estimate_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    recorded_by UUID NOT NULL REFERENCES profiles(id),
    visit_charge NUMERIC(10, 2),
    labour_amount NUMERIC(10, 2),
    parts_amount NUMERIC(10, 2),
    estimated_total NUMERIC(10, 2),
    warranty_text TEXT,
    customer_acknowledgement_status customer_acknowledgement_status NOT NULL DEFAULT 'NOT_REVIEWED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID REFERENCES service_requests(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES profiles(id),
    telegram_file_id TEXT,
    telegram_file_unique_id TEXT,
    storage_path TEXT,
    storage_reason storage_reason,
    file_size_bytes BIGINT,
    mime_type TEXT,
    attachment_type attachment_type NOT NULL,
    storage_promoted_at TIMESTAMPTZ,
    storage_promoted_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES profiles(id),
    reviewed_profile_id UUID NOT NULL REFERENCES profiles(id),
    score INT NOT NULL CHECK (score >= 1 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rating_pair UNIQUE (service_request_id, reviewer_id, reviewed_profile_id)
);

CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    reported_by UUID NOT NULL REFERENCES profiles(id),
    reported_against UUID NOT NULL REFERENCES profiles(id),
    complaint_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status complaint_status NOT NULL DEFAULT 'OPEN',
    operator_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- Webhook Idempotency Table (Spec v1.1 Section 7.15)
-- ----------------------------------------------------------------------------
CREATE TABLE processed_telegram_updates (
    update_id BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_result processing_result NOT NULL DEFAULT 'SUCCESS'
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX idx_profiles_tg_user ON profiles(telegram_user_id);
CREATE INDEX idx_technician_profiles_verification ON technician_profiles(verification_status);
CREATE INDEX idx_technician_availability_active ON technician_availability(technician_id, availability_status, location_expires_at);
CREATE INDEX idx_service_requests_status ON service_requests(status);
CREATE INDEX idx_service_requests_customer ON service_requests(customer_id);
CREATE INDEX idx_service_requests_technician ON service_requests(assigned_technician_id);
CREATE INDEX idx_service_requests_batch_progression ON service_requests(status, batch_progression_status, current_offer_batch);
CREATE INDEX idx_request_offers_status ON request_offers(service_request_id, offer_status, expires_at);
