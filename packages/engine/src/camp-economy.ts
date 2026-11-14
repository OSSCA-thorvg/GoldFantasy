import { Resources } from './building-catalog';
export class Ledger {
  wages = 0;
  rent = 0;
  sales = 0;
  guests = 0;
  bounty = 0;
  eaten = 0;
  drunk = 0;
  /** Market trade today, not saved: gold paid for goods, gold received for goods, and units moved. */
  bought = 0;
  sold = 0;
  traded = 0;
}
export class CampEconomy {
  faction = 0;
  renown = 0;
  today = new Ledger();
  yesterday = new Ledger();
  growingTended = 0;
  growingDays = 0;
  parched = false;
  spoiledDay = -1;
  arrivalTimer = 1;
  bardDue = -1;
  /** Day each mage tower rite was last performed here, by rite id. Transient. */
  riteDays = new Map<string, number>();
  constructor(
    public camp = -1,
    public stock = new Resources(),
  ) {}
}
export class CampReceipt {
  constructor(
    public serial = 0n,
    public camp = -1,
    public gain = new Resources(),
    public at = 0,
    public renown = 0,
    public residents = 0,
    public guests = 0,
  ) {}
}
