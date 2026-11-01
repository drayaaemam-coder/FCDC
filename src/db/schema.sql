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

-- محاور الأنشطة (inactive = محور قديم لم يعد يُعرض للاختيار، تبقى أنشطته المسجلة كما هي)
CREATE TABLE IF NOT EXISTS activity_types (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  sort_order  INT          NOT NULL DEFAULT 0
);
ALTER TABLE activity_types ADD COLUMN IF NOT EXISTS description TEXT    NOT NULL DEFAULT '';
ALTER TABLE activity_types ADD COLUMN IF NOT EXISTS active      BOOLEAN NOT NULL DEFAULT TRUE;

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

-- الخطة الشهرية: خطة مستقلة لكل مركز في كل شهر
CREATE TABLE IF NOT EXISTS monthly_plans (
  id              SERIAL       PRIMARY KEY,
  center_id       VARCHAR(20)  NOT NULL REFERENCES centers(id) ON UPDATE CASCADE,
  institution_id  VARCHAR(10)  NOT NULL REFERENCES institutions(id) ON UPDATE CASCADE,
  plan_month      CHAR(7)      NOT NULL,                       -- YYYY-MM
  status          VARCHAR(20)  NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','approved','returned')),
  admin_note      VARCHAR(600) NOT NULL DEFAULT '',
  created_by      INT          REFERENCES users(id) ON DELETE SET NULL,
  updated_by      INT          REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  reviewed_by     INT          REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  CONSTRAINT one_plan_per_center_month UNIQUE (center_id, plan_month)
);
CREATE INDEX IF NOT EXISTS monthly_plans_month_idx ON monthly_plans(plan_month, institution_id);

-- بنود الخطة: اسم النشاط، المحور، الفئة المستهدفة، العدد المتوقع، التاريخ والتوقيت، الجهة المنفذة/الشريكة، المسؤول
CREATE TABLE IF NOT EXISTS plan_items (
  id              SERIAL       PRIMARY KEY,
  plan_id         INT          NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  title           VARCHAR(140) NOT NULL,
  type_name       VARCHAR(100) NOT NULL,                       -- المحور
  target_group    VARCHAR(100) NOT NULL,
  expected_count  INT          NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
  item_date       DATE         NOT NULL,
  start_time      TIME         NOT NULL,
  end_time        TIME         NOT NULL,
  partner         VARCHAR(150) NOT NULL DEFAULT '',            -- الجهة المنفذة أو الشريكة
  responsible     VARCHAR(100) NOT NULL,                       -- المسؤول عن التنفيذ
  sort_order      INT          NOT NULL DEFAULT 0,
  CONSTRAINT plan_item_time_order CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS plan_items_plan_idx ON plan_items(plan_id);

-- ===== الدورة المستندية والاعتمادات =====
-- اعتماد الأنشطة المسجلة: pending (قيد المراجعة) → approved (معتمد) أو returned (معاد للتعديل)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS status      VARCHAR(20)  NOT NULL DEFAULT 'pending';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS review_note VARCHAR(600) NOT NULL DEFAULT '';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS reviewed_by INT          REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE activities ADD CONSTRAINT activities_status_chk CHECK (status IN ('pending','approved','returned'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS activities_status_idx ON activities(status, institution_id);
CREATE INDEX IF NOT EXISTS activities_batch_idx  ON activities(batch_id);

-- كود اعتماد الخطة الشهرية (يُطبع على الخطة ويمكن التحقق منه)
ALTER TABLE monthly_plans ADD COLUMN IF NOT EXISTS approval_code VARCHAR(40) UNIQUE;

-- التقارير والملفات الرسمية: تُحفظ نسختها كما قُدّمت، وتحصل على كود اعتماد عند الاعتماد
CREATE TABLE IF NOT EXISTS reports (
  id              SERIAL       PRIMARY KEY,
  kind            VARCHAR(10)  NOT NULL CHECK (kind IN ('m','q','y','media')),
  period          VARCHAR(10)  NOT NULL,                 -- 2026-11 | 2026-Q4 | 2026
  institution_id  VARCHAR(10)  REFERENCES institutions(id), -- NULL = تقرير قومي (كل المؤسسات)
  title           VARCHAR(300) NOT NULL,
  body            TEXT         NOT NULL,                 -- محتوى التقرير كما قُدّم (HTML)
  summary         JSONB        NOT NULL DEFAULT '{}',    -- أرقام رئيسية تظهر في صفحة التحقق
  status          VARCHAR(20)  NOT NULL CHECK (status IN ('submitted','approved','returned')),
  code            VARCHAR(40)  UNIQUE,
  review_note     VARCHAR(600) NOT NULL DEFAULT '',
  created_by      INT          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  reviewed_by     INT          REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reports_lookup_idx ON reports(kind, period, institution_id);

-- السجل الزمني لكل مستند (خطة / دفعة أنشطة / تقرير)
CREATE TABLE IF NOT EXISTS doc_events (
  id           SERIAL       PRIMARY KEY,
  entity_type  VARCHAR(20)  NOT NULL CHECK (entity_type IN ('plan','batch','report')),
  entity_id    VARCHAR(60)  NOT NULL,
  action       VARCHAR(30)  NOT NULL,
  actor_id     INT          REFERENCES users(id) ON DELETE SET NULL,
  note         VARCHAR(600) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_events_entity_idx ON doc_events(entity_type, entity_id, created_at);

-- التنبيهات
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL       PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(30)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        VARCHAR(600) NOT NULL DEFAULT '',
  link        JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);
