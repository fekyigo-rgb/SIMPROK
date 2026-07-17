export type CostCalculationResponse =
  | {
      status: "CALCULATED";
      boqItemId: string;
      volume: string;
      outputUnit: string;
      ahspUnitPrice: string;
      lineTotal: string;
      calculationPolicy: "COST_KERNEL_GRADE_A_V1";
    }
  | {
      status: "FAIL_CLOSED";
      boqItemId: string;
      reason: string;
      calculationPolicy: "COST_KERNEL_GRADE_A_V1";
    };

export const formatBackendRupiah = (value: string) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "Nilai tidak valid";
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = match[3] ? `,${match[3]}` : "";
  return `Rp ${match[1]}${grouped}${fraction}`;
};

export const toRabCostDisplay = (calculation: CostCalculationResponse) =>
  calculation.status === "CALCULATED"
    ? {
        badge: "Dihitung SIMPROK",
        unitPrice: formatBackendRupiah(calculation.ahspUnitPrice),
        lineTotal: formatBackendRupiah(calculation.lineTotal),
      }
    : { badge: calculation.reason, unitPrice: "—", lineTotal: "—" };
