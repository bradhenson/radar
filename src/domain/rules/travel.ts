// Travel rules (pure). No DOM or store imports.
import type { IsoDate } from "../models";
import { addDays } from "../../utils/dates";

/** A DTS travel voucher is due five days after the traveler returns. */
export const VOUCHER_DUE_DAYS_AFTER_RETURN = 5;

/** Default DTS voucher due date: five days after the travel end (return) date. */
export function travelVoucherDueDate(endDate: IsoDate): IsoDate {
  return addDays(endDate, VOUCHER_DUE_DAYS_AFTER_RETURN);
}
