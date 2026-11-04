# HomeOps Implementation Specification

**Version:** 1.1  
**Revision focus:** Serverless batch progression, contact fallback, fair rotation, storage protection, and schema alignment

## 1. What It Does

HomeOps is a lightweight, two-sided marketplace that connects customers who need home repair services with independently operating technicians who are currently available nearby.

The platform:

1. Collects a customer's service requirement and service location.
2. Finds approved technicians with the required skill.
3. Filters technicians using their current location, selected work radius, availability, workload, and account status.
4. Ranks eligible technicians using proximity, skill fit, reliability, rating, availability, and fair opportunity.
5. Offers the request to small batches of technicians.
6. Assigns the first eligible technician who accepts.
7. Reveals exact customer details only after successful assignment.
8. Allows the customer and technician to agree directly on scope, pricing, payment, and warranty.
9. Tracks request progress, completion, ratings, complaints, and reliability.

HomeOps does not collect or settle service payments and does not employ the technicians.

---

## 2. MVP Goals

1. Provide a customer with a suitable nearby technician without presenting a large directory.
2. Give technicians control over when they work, where they start, and how far they travel.
3. Prevent the same customer contact from being sold or exposed to multiple technicians.
4. Keep infrastructure and software costs near zero during validation.
5. Build an explainable matching process that can later support Telegram, WhatsApp, web, and mobile clients.
6. Validate the service in one small geographic market before expansion.

## 3. Non-Goals for Version 1

The MVP must not include:

- Platform-controlled pricing
- In-app payment collection
- Technician settlement or wallet
- Refund processing
- Percentage commissions
- Live background GPS tracking
- Traffic-aware route calculation
- Native Android or iOS applications
- AI-based diagnosis
- Generative AI conversations
- Automated parts inventory
- Platform-issued service warranty
- Multicity operations
- Microservices or Kubernetes

---

## 4. User Roles

### 4.1 Customer

A customer can:

- Register through Telegram
- Accept marketplace and privacy terms
- Create a service request
- Select a category and issue type
- Enter a problem description
- Upload issue photos
- Share the location where service is required
- Select a preferred service period
- Cancel a request
- Receive an assigned technician's profile
- Contact the assigned technician
- Acknowledge an optionally recorded estimate
- Confirm completion
- Rate the technician
- Raise a complaint
- View previous requests

### 4.2 Technician

A technician can:

- Apply to join the marketplace
- Submit identity and professional information
- Select skills
- Share a base work location
- Configure a default travel radius
- Configure a preferred maximum travel time
- Go online or offline
- Share a current work location
- Configure a temporary radius for an availability session
- Receive sanitized service offers
- Accept or decline an offer
- View exact customer details only after assignment
- Update request progress
- Record an estimate agreed with the customer
- Mark work complete or unable to complete
- Declare whether payment was handled directly
- Rate or report the customer

### 4.3 Operator

An operator can:

- Review technician applications
- Approve or reject technician skills
- Monitor active requests
- Manually assign or reassign a technician
- Correct incomplete location data
- Review stalled searches
- Handle complaints
- Warn, restrict, or suspend users
- Export operational data

### 4.4 Administrator

An administrator can:

- Manage operators and roles
- Manage service categories and issue types
- Configure matching weights
- Configure offer batch size and timeout
- Configure location expiration
- Configure active-job limits
- View audit records
- Suspend or reactivate accounts

---

## 5. System Architecture

```text
Customer on Telegram          Technician on Telegram
          |                            |
          +------------+---------------+
                       |
                       v
               Telegram Bot API
                       |
                 HTTPS Webhook
                       |
                       v
               Cloudflare Worker
      +----------------+----------------+
      |                |                |
      v                v                v
 Conversation     Matching and      Notification
 State Machine    Assignment        Dispatcher
      |                |                |
      +----------------+----------------+
                       |
                       v
                Supabase Backend
      +----------------+----------------+
      |                |                |
      v                v                v
 PostgreSQL       Authentication     File Storage
                       |
                       v
            React Operator Dashboard
              on Cloudflare Pages
```

### 5.1 Technology Stack

- Customer and technician interface: Telegram Bot
- Application runtime: TypeScript on Cloudflare Workers
- Database: Supabase PostgreSQL
- Operator authentication: Supabase Auth
- File storage: Telegram file references plus Supabase Storage for essential evidence
- Operator interface: React with TypeScript
- Dashboard hosting: Cloudflare Pages
- Database access: Supabase client or REST API
- Validation: Zod or equivalent schema validator
- Testing: Vitest for unit tests and Playwright for dashboard tests
- Source control and CI: GitHub and GitHub Actions
- Mapping: Telegram location and external map links only
- Distance calculation: Haversine formula executed within the application

### 5.2 Architectural Constraints

1. Use a modular monolith, not microservices.
2. Business rules must remain independent of Telegram-specific message structures.
3. Channel adapters must translate Telegram updates into internal commands.
4. Exact customer coordinates must not be exposed before assignment.
5. All state transitions must be validated by role and current state.
6. Assignment must be atomic to prevent two technicians accepting the same request.
7. Duplicate Telegram updates must be idempotently ignored.
8. Payment credentials and bank details must never be stored.

---

## 6. Core Workflows

## 6.1 Customer Registration

### Preconditions

- The user has opened a private chat with the Telegram bot.

### Steps

1. Customer sends `/start`.
2. System identifies the Telegram user ID.
3. System creates or retrieves a profile.
4. System displays marketplace and privacy terms.
5. Customer accepts the current terms version.
6. System collects name and optional shared contact.
7. System assigns the `CUSTOMER` role.
8. System displays the main customer menu.

### Postconditions

- A customer profile exists.
- Consent version and timestamp are recorded.

---

## 6.2 Technician Onboarding

### Steps

1. User selects **Apply as technician**.
2. System collects name and contact details.
3. System collects profile photo, experience, and reference information.
4. Technician selects one or more skills.
5. Technician shares a base work location.
6. Technician selects a default travel radius.
7. Technician optionally selects a preferred travel-time limit.
8. Technician submits identity or verification information.
9. Application status becomes `APPLIED`.
10. Operator reviews the application.
11. Operator approves the technician and approved skills.
12. Technician status becomes `APPROVED` and initially `OFFLINE`.

### Rules

- A technician cannot approve their own role or skill.
- An unapproved or suspended technician must never receive offers.
- Verification labels shown to customers must accurately describe what was reviewed.

---

## 6.3 Technician Availability

### Steps

1. Approved technician selects **Go online**.
2. System asks the technician to use the saved base location or share a current location.
3. Technician selects the effective radius for this session.
4. Technician selects an availability end time.
5. System creates an availability session.
6. Availability status becomes `ONLINE`.
7. Session expires when the technician goes offline, reaches the end time, or the location becomes stale.

### Rules

- Current location requires explicit technician action.
- No continuous background location tracking is used in Version 1.
- A current location expires after a configurable period, initially 8 hours.
- If the current location expires, the technician cannot receive proximity-based offers until it is refreshed or the base location is selected.

---

## 6.4 Customer Service Request

### Steps

1. Customer selects **Find a technician**.
2. Customer selects a service category.
3. Customer selects an issue type.
4. System displays a predefined safety warning when applicable.
5. Customer enters a description.
6. Customer optionally uploads up to three photos.
7. Customer shares the location where service is required or selects a saved address.
8. Customer chooses a preferred time window.
9. System displays a request summary and marketplace disclaimer.
10. Customer confirms the request.
11. System creates the request with status `REQUESTED`.
12. System changes status to `SEARCHING` and starts matching.

### Required Request Data

- Customer ID
- Service category
- Issue type
- Description
- Service latitude and longitude
- Preferred start and end time
- Urgency
- Terms version accepted

---

## 6.5 Matching and Assignment

### Eligibility Filters

A technician is eligible only if:

```text
account_status == ACTIVE
AND verification_status == APPROVED
AND technician has approved required skill
AND availability_status == ONLINE
AND location has not expired
AND calculated distance <= effective radius
AND availability overlaps requested time
AND active assignment count < maximum active jobs
AND technician is not already offered or assigned this request
```

### Distance Calculation

Use the Haversine formula to calculate straight-line distance between the technician's effective location and the service location.

```typescript
function calculateDistanceKm(
  technicianLocation: Coordinates,
  customerLocation: Coordinates
): number;
```

The returned value must be a non-negative distance in kilometres.

### Ranking Formula

```text
matchScore =
    skillFit * 30
  + proximity * 25
  + timeAvailability * 15
  + reliability * 15
  + rating * 10
  + fairness * 5
```

Each factor must be normalized between `0` and `1`.

```text
proximity = 1 - (distanceKm / effectiveRadiusKm)
```

Clamp proximity between `0` and `1`.

### Initial Defaults

- Batch size: 3 technicians
- First batch expiry: 90 seconds
- Second batch expiry: 90 seconds
- Final automatic batch expiry: 180 seconds
- Maximum active assignments per technician: 2
- Location expiration: 8 hours

All defaults must be configurable without a new deployment.

### Offer Workflow

1. Find eligible technicians.
2. Compute score and explanation metadata.
3. Sort eligible technicians by descending score.
4. Apply fair rotation where scores differ by less than five points.
5. Create offers for the first batch.
6. Send sanitized offer notifications.
7. Wait for a valid acceptance until expiry.
8. If no one accepts, expire the batch and send the next batch.
9. If all batches fail, set status to `NO_TECHNICIAN_FOUND` or route to operator review.

### Atomic Acceptance

A technician acceptance must update the request only when:

```text
request.status == SEARCHING
AND request.assigned_technician_id IS NULL
AND offer.status IN (SENT, VIEWED)
AND offer.expires_at > current_time
AND technician remains eligible
```

One database transaction or atomic database function must:

1. Assign the technician.
2. Change request status to `ASSIGNED`.
3. Mark the accepted offer `ACCEPTED`.
4. Mark competing offers `LOST_TO_ANOTHER_TECHNICIAN`.
5. Create an assignment event.

If the atomic update affects no request, the app must inform the technician that the request is no longer available.

---

## 6.6 Pre-Assignment Privacy

Before acceptance, a technician may see only:

- Service category
- Issue type
- General locality
- Approximate straight-line distance
- Preferred service period
- Whether photos are available
- Sanitized description

Before acceptance, a technician must not see:

- Exact coordinates
- Full address
- Apartment number
- Customer phone number
- Customer's complete request history

After successful assignment, the assigned technician may see the exact service location and permitted contact details.

---

## 6.7 Scope, Price, and Direct Payment

HomeOps does not quote, collect, confirm, refund, or settle the service payment.

After assignment, the customer and technician agree directly on:

- Visit charge
- Scope of work
- Labour amount
- Parts amount
- Payment method
- Payment timing
- Warranty terms, if any

Either party may optionally create an estimate record. The other party can mark it as:

- `ACKNOWLEDGED`
- `DISPUTED`
- `NOT_REVIEWED`

The estimate record is evidence of what was entered and is not a HomeOps quotation or guarantee.

Allowed payment declaration states:

- `NOT_APPLICABLE`
- `DIRECT_PAYMENT_CONFIRMED_BY_CUSTOMER`
- `DIRECT_PAYMENT_CONFIRMED_BY_TECHNICIAN`
- `PAYMENT_DISPUTE_REPORTED`

HomeOps must not claim that a direct payment is bank-verified.

---

## 6.8 Request Lifecycle

```text
DRAFT
  -> REQUESTED
  -> SEARCHING
      -> NO_TECHNICIAN_FOUND
      -> EXPIRED
      -> CANCELLED_BY_CUSTOMER
      -> ASSIGNED
          -> CONTACTED
          -> DISCUSSING_SCOPE
              -> DECLINED_AFTER_DISCUSSION
              -> AGREED
                  -> IN_PROGRESS
                      -> UNABLE_TO_COMPLETE
                      -> TECHNICIAN_MARKED_COMPLETE
                          -> CUSTOMER_CONFIRMATION_PENDING
                              -> COMPLETED
                              -> PARTIALLY_COMPLETED
                              -> DISPUTED
```

Additional cancellation states:

- `CANCELLED_BY_CUSTOMER`
- `CANCELLED_BY_TECHNICIAN`
- `CANCELLED_BY_OPERATOR`

### Transition Rules

- Only the assigned technician can mark `CONTACTED`, `AGREED`, `IN_PROGRESS`, or `TECHNICIAN_MARKED_COMPLETE`.
- Only the customer can confirm `COMPLETED` or `PARTIALLY_COMPLETED`.
- A technician cannot directly set `COMPLETED`.
- An operator can resolve or administratively close a disputed request.
- Every transition must create an immutable request event.

---

## 6.9 Ratings and Complaints

### Ratings

- Ratings are allowed only for participants in an assigned request.
- A customer can rate an assigned technician.
- A technician can rate the assigned customer.
- Each reviewer can submit only one rating per request.
- Rating range: 1 to 5.
- Ratings become available after completion or administrative closure.

### Complaints

Complaint statuses:

- `OPEN`
- `CUSTOMER_CONTACTED`
- `TECHNICIAN_CONTACTED`
- `UNDER_REVIEW`
- `RESOLVED`
- `ACCOUNT_ACTION_TAKEN`

Complaint handling must support:

- Description
- Complaint category
- Evidence attachments
- Operator notes
- Account warning
- Temporary suspension
- Permanent suspension

A suspended technician must immediately become ineligible for new offers.

---

## 7. Database Specification

## 7.1 `profiles`

```text
id: uuid, primary key
telegram_user_id: bigint, unique, not null
role: enum(CUSTOMER, TECHNICIAN, OPERATOR, ADMIN), not null
full_name: text, not null
phone_number: text, nullable
account_status: enum(ACTIVE, RESTRICTED, SUSPENDED, DELETED), not null
accepted_terms_version: text, nullable
accepted_terms_at: timestamptz, nullable
created_at: timestamptz, not null
updated_at: timestamptz, not null
```

## 7.2 `technician_profiles`

```text
id: uuid, primary key
profile_id: uuid, unique, foreign key profiles.id
verification_status: enum(APPLIED, UNDER_REVIEW, APPROVED, REJECTED, SUSPENDED)
experience_years: integer, nullable
profile_summary: text, nullable
base_latitude: decimal, nullable
base_longitude: decimal, nullable
default_radius_km: decimal, not null
preferred_travel_minutes: integer, nullable
accepts_extended_distance: boolean, default false
average_rating: decimal, default 0
completed_request_count: integer, default 0
acceptance_rate: decimal, default 0
completion_rate: decimal, default 0
post_acceptance_cancellation_rate: decimal, default 0
complaint_rate: decimal, default 0
probation_status: enum(NOT_STARTED, ACTIVE, COMPLETED), default NOT_STARTED
created_at: timestamptz, not null
updated_at: timestamptz, not null
```

## 7.3 `service_categories`

```text
id: uuid, primary key
name: text, unique, not null
description: text, nullable
active: boolean, default true
display_order: integer, not null
```

## 7.4 `issue_types`

```text
id: uuid, primary key
service_category_id: uuid, foreign key service_categories.id
name: text, not null
required_skill_code: text, not null
urgency_level: enum(NORMAL, PRIORITY, SAFETY_CRITICAL)
safety_message: text, nullable
active: boolean, default true
```

## 7.5 `technician_skills`

```text
id: uuid, primary key
technician_id: uuid, foreign key technician_profiles.id
service_category_id: uuid, foreign key service_categories.id
issue_type_id: uuid, nullable, foreign key issue_types.id
approval_status: enum(PENDING, APPROVED, REJECTED)
approved_by: uuid, nullable
approved_at: timestamptz, nullable
unique(technician_id, service_category_id, issue_type_id)
```

## 7.6 `technician_availability`

```text
id: uuid, primary key
technician_id: uuid, foreign key technician_profiles.id
availability_status: enum(ONLINE, OFFLINE, BUSY, EXPIRED)
location_source: enum(BASE_LOCATION, CURRENT_SHARED_LOCATION)
current_latitude: decimal, not null
current_longitude: decimal, not null
effective_radius_km: decimal, not null
available_from: timestamptz, not null
available_until: timestamptz, not null
location_updated_at: timestamptz, not null
location_expires_at: timestamptz, not null
created_at: timestamptz, not null
```

## 7.7 `customer_addresses`

```text
id: uuid, primary key
customer_id: uuid, foreign key profiles.id
label: text, not null
address_text: text, nullable
latitude: decimal, not null
longitude: decimal, not null
location_source: enum(TELEGRAM, MANUAL, OPERATOR_CORRECTED)
active: boolean, default true
created_at: timestamptz, not null
```

## 7.8 `service_requests`

```text
id: uuid, primary key
request_number: text, unique, not null
customer_id: uuid, foreign key profiles.id
assigned_technician_id: uuid, nullable, foreign key technician_profiles.id
service_category_id: uuid, foreign key service_categories.id
issue_type_id: uuid, foreign key issue_types.id
description: text, not null
service_address_text: text, nullable
service_latitude: decimal, not null
service_longitude: decimal, not null
preferred_start_time: timestamptz, not null
preferred_end_time: timestamptz, not null
urgency: enum(NORMAL, PRIORITY, SAFETY_CRITICAL)
status: service_request_status, not null
created_at: timestamptz, not null
search_started_at: timestamptz, nullable
assigned_at: timestamptz, nullable
work_started_at: timestamptz, nullable
completed_at: timestamptz, nullable
```

## 7.9 `request_offers`

```text
id: uuid, primary key
service_request_id: uuid, foreign key service_requests.id
technician_id: uuid, foreign key technician_profiles.id
distance_km: decimal, not null
technician_radius_km: decimal, not null
match_score: decimal, not null
match_explanation: jsonb, not null
offer_batch: integer, not null
offer_status: enum(SENT, VIEWED, ACCEPTED, DECLINED, EXPIRED, LOST_TO_ANOTHER_TECHNICIAN, CANCELLED)
offered_at: timestamptz, not null
viewed_at: timestamptz, nullable
responded_at: timestamptz, nullable
expires_at: timestamptz, not null
unique(service_request_id, technician_id)
```

## 7.10 `request_events`

```text
id: uuid, primary key
service_request_id: uuid, foreign key service_requests.id
event_type: text, not null
old_status: text, nullable
new_status: text, nullable
performed_by: uuid, nullable, foreign key profiles.id
notes: text, nullable
metadata: jsonb, nullable
created_at: timestamptz, not null
```

Events are append-only and must not be updated or deleted through normal application operations.

## 7.11 `estimate_records`

```text
id: uuid, primary key
service_request_id: uuid, foreign key service_requests.id
recorded_by: uuid, foreign key profiles.id
visit_charge: decimal, nullable
labour_amount: decimal, nullable
parts_amount: decimal, nullable
estimated_total: decimal, nullable
warranty_text: text, nullable
customer_acknowledgement_status: enum(NOT_REVIEWED, ACKNOWLEDGED, DISPUTED)
created_at: timestamptz, not null
```

## 7.12 `attachments`

```text
id: uuid, primary key
service_request_id: uuid, nullable, foreign key service_requests.id
uploaded_by: uuid, foreign key profiles.id
telegram_file_id: text, nullable
storage_path: text, nullable
attachment_type: enum(ISSUE_PHOTO, BEFORE_PHOTO, AFTER_PHOTO, COMPLAINT_EVIDENCE, VERIFICATION_DOCUMENT)
created_at: timestamptz, not null
expires_at: timestamptz, nullable
```

## 7.13 `ratings`

```text
id: uuid, primary key
service_request_id: uuid, foreign key service_requests.id
reviewer_id: uuid, foreign key profiles.id
reviewed_profile_id: uuid, foreign key profiles.id
score: integer, check score between 1 and 5
comment: text, nullable
created_at: timestamptz, not null
unique(service_request_id, reviewer_id, reviewed_profile_id)
```

## 7.14 `complaints`

```text
id: uuid, primary key
service_request_id: uuid, foreign key service_requests.id
reported_by: uuid, foreign key profiles.id
reported_against: uuid, foreign key profiles.id
complaint_type: text, not null
description: text, not null
status: complaint_status, not null
operator_notes: text, nullable
created_at: timestamptz, not null
resolved_at: timestamptz, nullable
```

## 7.15 `processed_telegram_updates`

```text
update_id: bigint, primary key
processed_at: timestamptz, not null
processing_result: enum(SUCCESS, IGNORED, FAILED)
```

---

## 8. Internal API Contracts

The Telegram adapter must call channel-independent application commands.

```typescript
type Coordinates = {
  latitude: number;
  longitude: number;
};

type CreateServiceRequestInput = {
  customerId: string;
  serviceCategoryId: string;
  issueTypeId: string;
  description: string;
  serviceLocation: Coordinates;
  serviceAddressText?: string;
  preferredStartTime: string;
  preferredEndTime: string;
  urgency: "NORMAL" | "PRIORITY" | "SAFETY_CRITICAL";
};

async function createServiceRequest(
  input: CreateServiceRequestInput
): Promise<ServiceRequest>;

async function findEligibleTechnicians(
  serviceRequestId: string
): Promise<RankedTechnician[]>;

async function createOfferBatch(
  serviceRequestId: string,
  batchNumber: number
): Promise<RequestOffer[]>;

async function acceptOffer(
  offerId: string,
  technicianId: string
): Promise<AssignmentResult>;

async function transitionRequest(
  requestId: string,
  actorId: string,
  targetStatus: ServiceRequestStatus
): Promise<ServiceRequest>;
```

### Validation Rules

- Coordinates must use latitude between `-90` and `90`.
- Longitude must be between `-180` and `180`.
- Radius must be greater than `0` and no more than the configured maximum.
- Preferred end time must be later than preferred start time.
- Descriptions must be length-limited and sanitized.
- Media count and size must be restricted.
- Callback payloads must be signed or mapped to server-side IDs rather than trusting arbitrary client data.

---

## 9. Telegram Bot Menus

## 9.1 Customer Menu

```text
Find a technician
My requests
Saved addresses
Support
Terms and privacy
```

## 9.2 Technician Menu

```text
Go online / Go offline
Current assignments
Available offers
My skills
Location and work radius
Performance
Support
```

## 9.3 Offer Message

```text
New service request

Service: Plumbing
Issue: Pipe leakage
Area: Whitefield
Approximate straight-line distance: 3.8 km
Preferred time: Today, 3 PM-5 PM
Photos available: Yes

Actual road distance and travel time may vary.
Price and payment are agreed directly with the customer.

[Accept] [Decline] [View approximate area]
```

## 9.4 Assignment Message to Customer

```text
Technician found

Name: Rajesh K.
Approved skill: Plumbing
Rating: 4.7/5
Completed through HomeOps: 43
Approximate starting distance: 3.8 km

Discuss scope, price, payment, and warranty directly before work begins.

[Connect] [Request another technician] [Cancel]
```

---

## 10. Operator Dashboard Requirements

### 10.1 Authentication

- Operator login through Supabase Auth
- MFA required for administrator roles
- Inactive operator accounts denied access
- Session timeout and logout support

### 10.2 Screens

1. Overview dashboard
2. Active request board
3. Request details
4. Technician applications
5. Technician monitoring
6. Complaint queue
7. Service catalogue configuration
8. Matching configuration
9. Audit-event viewer
10. CSV export

### 10.3 Dashboard Metrics

- Requests created
- Requests currently searching
- Match success rate
- Median time to acceptance
- No-technician-found rate
- Technician acceptance rate
- Post-acceptance cancellation rate
- Completion rate
- Complaint rate
- Repeat customer rate
- Number of online technicians

---

## 11. Security and Privacy Requirements

1. Telegram bot token must be stored only as an environment secret.
2. Telegram webhook secret token must be validated.
3. Telegram `update_id` must be used for idempotency.
4. Supabase service-role credentials must never be exposed to the browser.
5. Row-level security must be active on all user-data tables.
6. Customers may read only their own profiles, addresses, requests, ratings, and complaints.
7. Technicians may read only their profile, availability, offers, and assigned request details.
8. Candidate technicians may access only sanitized offer data.
9. Exact customer coordinates may be released only after atomic assignment.
10. Operator and administrator actions must be audited.
11. Precise technician current locations must not be displayed to customers.
12. Payment credentials must never be collected.
13. Verification documents must use restricted storage access.
14. Upload type, count, and size must be limited.
15. Logs must avoid full addresses, bot tokens, contact details, and precise coordinates.
16. Data deletion and retention processes must be documented.
17. Account suspension must immediately invalidate eligibility for new offers.

---

## 12. Retention Requirements

Initial pilot defaults:

- Telegram update idempotency records: 30 days
- Normal service media: 90 days
- Current technician availability location: until session expiry plus 7 days of restricted operational logs
- Request events: retain while the account and request record are active
- Complaint evidence: until resolution plus the configured complaint-retention period
- Verification documents: while technician is active, followed by a documented deletion review

All retention values must be configurable and aligned with the final privacy policy.

---

## 13. Error and Recovery Requirements

The application must handle:

- Duplicate Telegram webhook delivery
- Invalid or expired callback action
- Technician accepting after offer expiry
- Two technicians accepting simultaneously
- Customer cancellation while offers are active
- Technician going offline after receiving an offer
- Missing or stale technician location
- Invalid customer coordinates
- No eligible technician
- No technician accepting
- Technician cancellation after assignment
- Failed Telegram message delivery
- Temporary Supabase failure
- Unauthorized data access
- Oversized or unsupported upload

A failed notification must not silently corrupt request state. The system must record the failure and expose it to the operator.

---

## 14. Testing Requirements

## 14.1 Unit Tests

Test at minimum:

- Haversine distance calculation
- Coordinate validation
- Radius eligibility
- Time overlap
- Skill eligibility
- Match-score bounds
- Fair rotation
- Reliability calculation
- Allowed state transitions
- Forbidden state transitions
- Sanitized offer generation

## 14.2 Integration Tests

Test at minimum:

- Customer registration to request creation
- Technician application to approval
- Technician online session creation
- Eligible technician search
- Offer batch creation
- Successful atomic assignment
- Simultaneous acceptance race
- Batch expiry and next batch
- Customer cancellation during search
- Technician cancellation and reassignment
- Completion and rating
- Complaint and suspension
- Duplicate Telegram update handling

## 14.3 Security Tests

Test at minimum:

- Customer cannot read another customer's request
- Technician cannot browse unoffered requests
- Candidate technician cannot read exact location
- Unassigned technician cannot retrieve assigned request details
- Suspended technician cannot go online
- Browser cannot use service-role permissions
- Invalid webhook secret is rejected
- Modified callback payload is rejected

## 14.4 Pilot Acceptance Tests

Before launch:

1. Create a request with valid coordinates.
2. Match at least three controlled test technicians.
3. Verify ranking order.
4. Accept from two technicians concurrently.
5. Confirm only one assignment.
6. Verify exact location is disclosed only to the winner.
7. Complete the request without a platform payment.
8. Submit ratings.
9. Raise and resolve a complaint.
10. Suspend a technician and confirm they receive no further offers.

---

## 15. Implementation Work Plan

## Phase 0: Product Preparation, Week 1

- Finalize three service categories
- Define issue types and safety warnings
- Define technician verification policy
- Define customer and technician terms
- Define cancellation and complaint policy
- Interview prospective customers and technicians
- Finalize MVP success metrics

## Phase 1: Platform Foundation, Week 2

- Create repositories and environments
- Create Telegram bot
- Create Supabase project and migrations
- Create Cloudflare Worker
- Configure webhook and secrets
- Add logging and idempotency
- Configure row-level security

## Phase 2: Customer Workflow, Week 3

- Registration and consent
- Category and issue selection
- Description and photo collection
- Service-location collection
- Time selection
- Request review and creation
- Search and cancellation status

## Phase 3: Technician Onboarding, Week 4

- Technician application
- Skills and experience
- Base work location
- Default radius
- Verification workflow
- Operator approval
- Probation support

## Phase 4: Technician Availability, Week 5

- Go online and offline
- Base or current location
- Temporary session radius
- Availability period
- Location expiry
- Active-job capacity

## Phase 5: Matching Engine, Week 6

- Haversine calculation
- Hard eligibility filters
- Ranking factors
- Fair rotation
- Match explanation metadata
- Automated test coverage

## Phase 6: Offer and Assignment, Week 7

- Batched offers
- Offer expiry
- Accept and decline
- Atomic assignment
- Competing-offer closure
- Exact-location release
- Operator escalation

## Phase 7: Service Lifecycle, Week 8

- Contacted and agreed statuses
- Optional estimate record
- Work started and completed
- Customer confirmation
- Partial completion and dispute
- Direct-payment declarations

## Phase 8: Trust Layer, Week 9

- Ratings
- Complaint workflow
- Reliability metrics
- Warning and suspension
- Technician performance view

## Phase 9: Operator Dashboard, Week 10

- Authentication
- Request board
- Technician application queue
- Monitoring
- Complaint handling
- Configuration
- CSV export

## Phase 10: Hardening, Week 11

- Security testing
- Privacy review
- Race-condition testing
- Failure recovery
- Backup and restore test
- Usage monitoring
- Pilot runbook

## Phase 11: Controlled Pilot, Weeks 12-14

- Launch in one small locality
- Onboard 5-10 technicians
- Invite 20-50 customers
- Manually review all matches
- Measure outcomes
- Tune weights and timeouts
- Document failures before expansion

---

## 16. MVP Success Criteria

The MVP is successful when it reaches the following pilot targets:

- Match success rate above 70%
- Median technician acceptance below 10 minutes
- Accepted-request completion above 80%
- Technician no-show rate below 5%
- Complaint rate below 10%
- At least 25% repeat usage or stated repeat intent
- No duplicate assignment incidents
- No unauthorized exact-location disclosure
- Operator can review and explain every assignment

These are internal validation targets, not customer-facing guarantees.

---

## 17. Deployment Requirements

### Environments

- Local development
- Shared test/staging
- Production pilot

### CI/CD

On every pull request:

- Type checking
- Linting
- Unit tests
- Migration validation
- Secret scanning

On approved merge:

- Deploy Worker
- Deploy dashboard
- Apply reviewed database migration
- Run smoke tests

Production database migrations must be version-controlled and reversible where practical.

---


## 18. Implementation Clarifications

### 18.1 Serverless Batch Progression

Cloudflare Worker request handlers must not hold an in-memory timer or wait for an offer batch to expire. Batch progression is database-driven and triggered by a scheduled Worker invocation.

#### Primary mechanism

Configure a Cloudflare Cron Trigger to invoke the Worker's `scheduled()` handler every minute:

```jsonc
{
  "triggers": {
    "crons": ["* * * * *"]
  }
}
```

The scheduled handler must:

1. Query service requests in `SEARCHING` status whose current batch has no accepted offer and whose maximum active `expires_at` is earlier than the database time.
2. Lock or atomically claim each request for batch progression.
3. Mark outstanding offers in the expired batch as `EXPIRED`.
4. Determine whether unoffered eligible technicians remain.
5. Create and dispatch the next batch, or transition the request to `NO_TECHNICIAN_FOUND` or operator review.
6. Record a `BATCH_EXPIRED`, `BATCH_ADVANCED`, or `SEARCH_EXHAUSTED` event.

The job must be idempotent. Reprocessing the same expired batch must not create duplicate offers or increment the batch more than once.

Because the scheduler runs once per minute, a nominal 90-second expiry may progress between approximately 90 and 150 seconds after creation. Customer-facing copy must therefore avoid promising exact second-level progression.

#### Atomic claim requirement

Add progression fields to `service_requests`:

```text
current_offer_batch: integer, default 0
batch_progression_status: enum(IDLE, PROCESSING), default IDLE
batch_progression_claimed_at: timestamptz, nullable
operator_review_required: boolean, default false
```

Batch progression must atomically change `batch_progression_status` from `IDLE` to `PROCESSING`. A stale claim may be recovered after a configurable timeout. The process must reset the field to `IDLE` after success or controlled failure.

#### Alternative mechanism

A database scheduler may call a protected Worker endpoint such as `/internal/expire-batches`. If used, the endpoint must require a secret bearer token, apply idempotency, and execute the same batch-progression service used by the scheduled handler.

---

### 18.2 Customer Contact Fallback

A customer phone number is optional, and a Telegram username may be absent. Assignment must therefore expose contact methods in the following priority order:

1. Verified or explicitly shared phone number as a `tel:` link.
2. Public Telegram username using `https://t.me/<username>`.
3. Telegram user mention/deep link generated from the stored Telegram user ID when supported by the receiving client and the user's privacy settings.
4. Bot-mediated relay when no direct method is usable.

The bot-mediated relay is the guaranteed fallback. It allows either assigned party to send a message to the bot, which forwards a sanitized copy to the other party without exposing additional personal information.

Contact data additions to `profiles`:

```text
telegram_username: text, nullable
phone_number: text, nullable
phone_number_source: enum(SHARED_CONTACT, MANUAL, OPERATOR_VERIFIED), nullable
allow_direct_contact_after_assignment: boolean, default true
```

Add an `assignment_conversations` table for relay support:

```text
id: uuid, primary key
service_request_id: uuid, unique, foreign key service_requests.id
customer_id: uuid, foreign key profiles.id
technician_id: uuid, foreign key profiles.id
relay_status: enum(ACTIVE, CLOSED, BLOCKED)
created_at: timestamptz, not null
closed_at: timestamptz, nullable
```

The system must never claim that communication is available merely because a Telegram user ID exists. It must test the configured contact path and retain bot relay as the final fallback.

---

### 18.3 Deterministic Fair Rotation

Fair rotation applies only after mandatory filters pass and only among technicians whose final scores fall within five points of the highest score for the current selection position.

The deterministic sort order is:

```text
1. Score band, descending
2. last_offered_at, ascending, NULLS FIRST
3. recent_offer_count_7d, ascending
4. recent_assignment_count_30d, ascending
5. probation priority, descending when the request is non-critical
6. technician profile creation time, ascending
7. technician ID, ascending as the final stable tie-breaker
```

`active_probation` must never override safety, skill, distance, availability, workload, suspension, or reliability thresholds. Probation priority applies only to non-safety-critical requests and may be capped to a configurable percentage of offers.

Add or derive the following technician metrics:

```text
last_offered_at: timestamptz, nullable
recent_offer_count_7d: integer
recent_assignment_count_30d: integer
```

The ranking service must save the pre-rotation score and final ordering explanation in `request_offers.match_explanation`.

---

### 18.4 Media Storage Protection

Initial customer issue photos must remain on Telegram by storing `telegram_file_id`; they must not be copied to Supabase Storage during normal request creation.

Supabase Storage is reserved for:

- Technician verification documents selected for operator review
- Complaint or dispute evidence that an operator explicitly preserves
- Essential final evidence required under the retention policy

The application must store both `telegram_file_id` and, when available, `telegram_file_unique_id`. It must request a fresh file path through Telegram when retrieval is required rather than persisting temporary download URLs.

Update `attachments`:

```text
telegram_file_id: text, nullable
telegram_file_unique_id: text, nullable
storage_path: text, nullable
storage_reason: enum(VERIFICATION, COMPLAINT, ESSENTIAL_EVIDENCE), nullable
file_size_bytes: bigint, nullable
mime_type: text, nullable
storage_promoted_at: timestamptz, nullable
storage_promoted_by: uuid, nullable
```

Protection rules:

1. Maximum three initial service photos.
2. Reject unsupported media and enforce configurable size limits.
3. Never persist Telegram file download URLs because they are temporary.
4. Copy to Supabase only through an operator-controlled promotion action or an explicit complaint workflow.
5. Monitor storage utilization and alert operators at configurable thresholds, initially 70% and 85%.
6. If a Telegram file becomes unavailable, mark the attachment `SOURCE_UNAVAILABLE`; do not silently treat it as retained evidence.

---

### 18.5 Canonical Schema and Enum Alignment

The implementation specification is the canonical source for new migrations. Existing development migrations must be reconciled before additional feature migrations are created.

Canonical `account_status` values:

```text
ACTIVE
RESTRICTED
SUSPENDED
DELETED
```

Migration mapping from the initial development enum:

```text
ACTIVE     -> ACTIVE
WARNED     -> RESTRICTED
SUSPENDED  -> SUSPENDED
PENDING    -> RESTRICTED
```

A pending technician application is represented by `technician_profiles.verification_status`, not by `profiles.account_status`.

Canonical `probation_status` values:

```text
NOT_STARTED
ACTIVE
COMPLETED
```

A boolean probation flag must not be used. If an initial boolean exists, migrate it as follows:

```text
false -> NOT_STARTED
true  -> ACTIVE
```

Operator completion of probation explicitly transitions `ACTIVE` to `COMPLETED`.

#### Migration acceptance checks

Before merging the reconciliation migration:

1. Search application code, tests, seed data, RLS policies, and dashboard filters for obsolete enum values.
2. Migrate existing rows inside a transaction.
3. Replace enum types or constraints safely.
4. Recreate dependent functions and policies where required.
5. Run schema-contract tests against a clean database and an upgraded database.
6. Block deployment if the generated database types differ from the committed application types.

---

### 18.6 Revised Operational Definition of Done

In addition to the main Definition of Done, the pilot is not operationally ready until:

1. Scheduled batch progression has been tested across at least three consecutive batches.
2. Repeated scheduler execution creates no duplicate offers.
3. A customer without a phone number and username can communicate through bot relay.
4. Fair rotation produces a deterministic ordering under identical inputs.
5. Normal issue photos create no Supabase Storage objects.
6. Existing migrations and application enums match the canonical schema exactly.

---

## 19. Future Extensions

After the pilot validates demand, the architecture may add:

- WhatsApp channel adapter
- Paid routing and travel-time estimation
- Masked calling
- Technician subscription or exclusive-connection credits
- Apartment association portal
- Recurring maintenance reminders
- Multilingual bot flows
- AI-assisted free-text categorization
- Native technician application with controlled background location
- Customer web application

These additions must use the same channel-independent request, matching, offer, assignment, and trust modules.

---

## 20. Definition of Done

The MVP is done when:

1. A customer can create a location-based service request through Telegram.
2. An approved technician can go online with a current location and selected radius.
3. The system can identify and rank eligible technicians.
4. Offers are sent in configurable batches.
5. Exactly one technician can accept and be assigned.
6. Exact customer location is hidden until assignment.
7. Customer and technician can coordinate without platform payment handling.
8. The request can be completed, rated, disputed, or cancelled.
9. Operators can approve technicians, monitor requests, and handle complaints.
10. Security, role permissions, idempotency, and assignment-race tests pass.
11. The system can operate within the selected free-tier infrastructure for the pilot.
