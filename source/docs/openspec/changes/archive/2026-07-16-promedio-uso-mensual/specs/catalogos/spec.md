# Delta for Catalogos

## ADDED Requirements

### Requirement: Seed Monthly Usage on Product Creation

The system MUST accept an optional initial monthly usage average upon creation or import. If provided, the system SHALL initialize both `promedio_uso_mensual` and `promedio_uso_mensual_inicial` with this value. If not provided, both fields MUST default to `0.00`.

#### Scenario: Product creation with seed value
- GIVEN a new product is being created with a seed monthly usage of 150.00
- WHEN the creation transaction is executed
- THEN the product record MUST have `promedio_uso_mensual` set to 150.00 and `promedio_uso_mensual_inicial` set to 150.00

#### Scenario: Product creation without seed value
- GIVEN a new product is being created with no seed value provided
- WHEN the creation transaction is executed
- THEN the product record MUST have `promedio_uso_mensual` set to 0.00 and `promedio_uso_mensual_inicial` set to 0.00

---

### Requirement: Nightly Average Consumption Recalculation

The system MUST run a scheduled process nightly that calculates the sum of all consumptions in the last 30 days for each product. The resulting values MUST be used to update `promedio_uso_mensual` according to the age of the product.

#### Scenario: Scheduled nightly execution finishes successfully
- GIVEN products with various ages and consumption records exist
- WHEN the nightly recalculation scheduler runs
- THEN it MUST calculate the sum of consumptions for the last 30 days for each product
- AND it MUST update `promedio_uso_mensual` for each product based on its age and the calculated consumption sum

---

### Requirement: Seed Value Blend for New Products

For products created less than 30 days ago, the system MUST blend the initial seed value with actual consumption using the formula:
`P_adjusted = Sum_30d + (1 - Age_Days / 30) * P_initial`
where:
- `Sum_30d` is the sum of actual consumptions in the last 30 days.
- `Age_Days` is the number of days elapsed since the product was created.
- `P_initial` is the `promedio_uso_mensual_inicial`.

#### Scenario: Blend formula calculation for new product
- GIVEN a product created 10 days ago (Age_Days = 10)
- AND its initial seed `promedio_uso_mensual_inicial` is 90.00
- AND its sum of actual consumptions in the last 30 days is 20.00
- WHEN the nightly recalculation runs
- THEN the system MUST set `promedio_uso_mensual` to 80.00 (calculated as: 20.00 + (1 - 10/30) * 90.00 = 20.00 + (2/3) * 90.00 = 80.00)

---

### Requirement: Simple Rolling Sum for Older Products

For products created 30 or more days ago, the system MUST set the monthly average to the simple sum of the last 30 days of consumptions:
`P_adjusted = Sum_30d`

#### Scenario: Simple rolling sum calculation for older product
- GIVEN a product created 45 days ago (Age_Days = 45)
- AND its initial seed `promedio_uso_mensual_inicial` is 90.00
- AND its sum of actual consumptions in the last 30 days is 35.00
- WHEN the nightly recalculation runs
- THEN the system MUST set `promedio_uso_mensual` to 35.00

## MODIFIED Requirements

None.
