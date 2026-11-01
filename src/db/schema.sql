-- منظومة متابعة أنشطة مراكز تنمية الأسرة والطفولة
-- PostgreSQL schema (idempotent: safe to run more than once)

CREATE TABLE IF NOT EXISTS institutions (
  id          VARCHAR(10)  PRIMARY KEY,
  name        VARCHAR(200) NOT NULL UNIQUE,
  sort_order  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS centers (
  id              VARCHAR(20)  PRIMARY KEY,           -- e.g. hk-01
  institution_id  VARCHAR(10)  NOT NULL REFERENCES institutions(id) ON UPDATE CASCADE,
  governorate     VARCHAR(100) NOT NULL,              -- المحافظة
  markaz          VARCHAR(100) NOT NULL,              -- المركز الإداري
  village         VARCHAR(150) NOT NULL,              -- القرية
  active          BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS centers_inst_idx ON centers(institution_id);

CREATE TABLE IF NOT EXISTS activity_types (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  sort_order  INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL       PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(200) NOT NULL UNIQUE,
  password_hash   VARCHAR(200) NOT NULL,
  role            VARCHAR(20)  NOT NULL CHECK (role IN ('admin','institution')),
  institution_id  VARCHAR(10)  REFERENCES institutions(id),
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT institution_users_need_inst CHECK (role = 'admin' OR institution_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS activities (
  id              SERIAL       PRIMARY KEY,
  center_id       VARCHAR(20)  NOT NULL REFERENCES centers(id) ON UPDATE CASCADE,
  institution_id  VARCHAR(10)  NOT NULL REFERENCES institutions(id) ON UPDATE CASCADE,
  governorate     VARCHAR(100) NOT NULL,
  activity_date   DATE         NOT NULL,
  activity_month  CHAR(7)      NOT NULL,              -- YYYY-MM, used for duplicate rule
  type_name       VARCHAR(100) NOT NULL,
  title           VARCHAR(140) NOT NULL,
  title_norm      VARCHAR(200) NOT NULL,              -- normalized Arabic title for duplicate detection
  kids            INT          NOT NULL DEFAULT 0 CHECK (kids  >= 0),
  women           INT          NOT NULL DEFAULT 0 CHECK (women >= 0),
  men             INT          NOT NULL DEFAULT 0 CHECK (men   >= 0),
  partner         VARCHAR(100) NOT NULL DEFAULT '',
  media_link      VARCHAR(400) NOT NULL DEFAULT '',
  notes           VARCHAR(600) NOT NULL DEFAULT '',
  batch_id        VARCHAR(40)  NOT NULL,
  created_by      INT          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- لا يُقبل نشاط بنفس العنوان في نفس المركز خلال نفس الشهر
  CONSTRAINT activities_no_dup_title UNIQUE (center_id, activity_month, title_norm)
);
CREATE INDEX IF NOT EXISTS activities_date_idx   ON activities(activity_date DESC);
CREATE INDEX IF NOT EXISTS activities_inst_idx   ON activities(institution_id, activity_date);
CREATE INDEX IF NOT EXISTS activities_center_idx ON activities(center_id, activity_date);

CREATE TABLE IF NOT EXISTS photos (
  id           SERIAL       PRIMARY KEY,
  activity_id  INT          NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  full_file    VARCHAR(200) NOT NULL,
  thumb_file   VARCHAR(200) NOT NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_activity_idx ON photos(activity_id);
