# =============================================================================
# Banking Platform — initial schema baseline
# This migration creates the platform-wide reference tables used by all
# business modules. Subsequent migrations add module-specific tables.
# =============================================================================

CREATE SCHEMA IF NOT EXISTS bank;
SET search_path TO bank;

-- UUID generator (PostgreSQL 13+ has gen_random_uuid via pgcrypto).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
# Sequences for human-friendly IDs (account_no, transaction_no, etc.)
# These are added by module-specific migrations; none here.
# =============================================================================

-- =============================================================================
# Lookup tables shared by every module
# =============================================================================
CREATE TABLE currency (
    code            CHAR(3)            PRIMARY KEY,
    name            VARCHAR(64)        NOT NULL,
    symbol          VARCHAR(8)         NOT NULL,
    decimal_places  SMALLINT           NOT NULL DEFAULT 2,
    is_active       BOOLEAN            NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE TABLE country (
    code            CHAR(2)            PRIMARY KEY,
    name            VARCHAR(96)        NOT NULL,
    iso3            CHAR(3)            NOT NULL UNIQUE,
    phone_code      VARCHAR(8),
    is_active       BOOLEAN            NOT NULL DEFAULT TRUE
);

-- =============================================================================
# Tenancy
# =============================================================================
CREATE TABLE tenant (
    id              UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(32)        NOT NULL UNIQUE,
    legal_name      VARCHAR(256)       NOT NULL,
    display_name    VARCHAR(128)       NOT NULL,
    country_code    CHAR(2)            NOT NULL REFERENCES country(code),
    base_currency   CHAR(3)            NOT NULL REFERENCES currency(code),
    status          VARCHAR(16)        NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
    version         BIGINT             NOT NULL DEFAULT 0
);

CREATE INDEX idx_tenant_status ON tenant(status);

-- =============================================================================
# Reference data
# =============================================================================
INSERT INTO currency (code, name, symbol, decimal_places) VALUES
    ('USD', 'United States Dollar',     '$',  2),
    ('EUR', 'Euro',                     '€',  2),
    ('GBP', 'Pound Sterling',           '£',  2),
    ('INR', 'Indian Rupee',             '₹',  2),
    ('AED', 'UAE Dirham',               'د.إ', 2),
    ('JPY', 'Japanese Yen',             '¥',  0),
    ('SGD', 'Singapore Dollar',         'S$', 2),
    ('AUD', 'Australian Dollar',        'A$', 2),
    ('CAD', 'Canadian Dollar',          'C$', 2),
    ('CHF', 'Swiss Franc',              'Fr', 2);

INSERT INTO country (code, name, iso3, phone_code) VALUES
    ('US', 'United States',     'USA', '+1'),
    ('GB', 'United Kingdom',    'GBR', '+44'),
    ('IN', 'India',             'IND', '+91'),
    ('AE', 'United Arab Emirates','ARE','+971'),
    ('JP', 'Japan',             'JPN', '+81'),
    ('SG', 'Singapore',         'SGP', '+65'),
    ('AU', 'Australia',         'AUS', '+61'),
    ('CA', 'Canada',            'CAN', '+1'),
    ('CH', 'Switzerland',       'CHE', '+41'),
    ('DE', 'Germany',           'DEU', '+49');
