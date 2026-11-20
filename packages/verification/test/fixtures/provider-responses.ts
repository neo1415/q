/**
 * Recorded-shape provider responses for the V1 adapters. Synthetic: every
 * company, person and number is invented, and the shapes follow each
 * provider's published API reference. No live call produced or uses them.
 */
export const COMPANIES_HOUSE_PROFILE = {
  company_name: "EXAMPLE ROBOTICS LTD",
  company_number: "01234567",
  company_status: "active",
  date_of_creation: "2021-03-04",
  type: "ltd",
  jurisdiction: "england-wales",
};

export const COMPANIES_HOUSE_OFFICERS = {
  total_results: 3,
  items: [
    {
      name: "EXAMPLE, Ada Ngozi",
      officer_role: "director",
      appointed_on: "2021-03-04",
    },
    {
      name: "SAMPLE, Bo",
      officer_role: "director",
      appointed_on: "2021-03-04",
      resigned_on: "2023-01-10",
    },
    {
      name: "FICTIONAL SECRETARIES LIMITED",
      officer_role: "corporate-secretary",
    },
  ],
};

export const COMPANIES_HOUSE_PSC = {
  items: [
    {
      name: "Mr Cai Placeholder",
      kind: "individual-person-with-significant-control",
    },
    {
      name: "Holding Example Ltd",
      kind: "corporate-entity-person-with-significant-control",
    },
  ],
};

export const DOJAH_BUSINESS_NG = {
  entity: {
    company_name: "LAGOS EXAMPLE TECHNOLOGIES LIMITED",
    rc_number: "RC1234567",
    status: "ACTIVE",
    date_of_registration: "2020-06-15T00:00:00.000Z",
    affiliates: [
      {
        first_name: "Ada",
        last_name: "Example",
        affiliate_type: "DIRECTOR",
        status: "ACTIVE",
      },
      {
        first_name: "Tunde",
        other_name: "K",
        last_name: "Sample",
        affiliate_type: "SHAREHOLDER",
        status: "ACTIVE",
      },
      {
        first_name: "Old",
        last_name: "Director",
        affiliate_type: "DIRECTOR",
        status: "RESIGNED",
      },
    ],
  },
};

export const DOJAH_BVN_SELFIE = {
  entity: {
    bvn: "22200000000",
    first_name: "ADA",
    middle_name: "NGOZI",
    last_name: "EXAMPLE",
    date_of_birth: "1990-01-01",
    selfie_verification: { confidence_value: 99.1, match: true },
  },
};

export const SUMSUB_APPLICANT_CREATED = {
  id: "5f00000000000000000000aa",
  createdAt: "2026-11-20 10:00:00",
  review: { reviewStatus: "init" },
};

export const SUMSUB_PERSON_GREEN = {
  id: "5f00000000000000000000aa",
  info: { firstName: "Eve", lastName: "Placeholder", country: "DEU" },
  review: {
    reviewStatus: "completed",
    reviewResult: { reviewAnswer: "GREEN" },
  },
};

export const SUMSUB_PERSON_PENDING = {
  id: "5f00000000000000000000aa",
  info: { firstName: "Eve", lastName: "Placeholder" },
  review: { reviewStatus: "pending" },
};

export const SUMSUB_COMPANY_GREEN = {
  id: "5f00000000000000000000bb",
  info: {
    companyInfo: {
      companyName: "Beispiel Software GmbH",
      registrationNumber: "HRB 123456",
      country: "DEU",
      incorporatedOn: "2019-05-01",
      beneficiaries: [
        {
          info: { firstName: "Eve", lastName: "Placeholder" },
          types: ["director", "ubo"],
        },
        {
          info: { firstName: "Finn", lastName: "Muster" },
          types: ["shareholder"],
        },
      ],
    },
  },
  review: {
    reviewStatus: "completed",
    reviewResult: { reviewAnswer: "GREEN" },
  },
};
