export interface BuildingBlock {
  bounds: number[];
  wall: number;
  roof: number;
  base: number;
  shape: string;
  wallLit: number[];
  wallShade: number[];
  roofLit: number[];
  roofShade: number[];
  delay: number;
  windows: number;
  door: boolean;
  trim: string;
  glass: number[];
  ornament: string;
  accent: number[];
}
export interface BuildingPatch {
  bounds: number[];
  color: number[];
  furrows: number;
  furrow: number[];
  delay: number;
}
export interface BuildingVariant {
  blocks: BuildingBlock[];
  patches: BuildingPatch[];
}
export interface BuildingAsset {
  format: string;
  version: number;
  id: string;
  name: string;
  footprint: number;
  variants: BuildingVariant[];
}
import CampAsset from '../assets/buildings/camp.json';
import TentAsset from '../assets/buildings/tent.json';
import CottageAsset from '../assets/buildings/cottage.json';
import TownhouseAsset from '../assets/buildings/townhouse.json';
import ManorAsset from '../assets/buildings/manor.json';
import MarketStallsAsset from '../assets/buildings/market-stalls.json';
import MarketHallAsset from '../assets/buildings/market-hall.json';
import BazaarAsset from '../assets/buildings/bazaar.json';
import FarmAsset from '../assets/buildings/farm.json';
import LumberyardAsset from '../assets/buildings/lumberyard.json';
import QuarryAsset from '../assets/buildings/quarry.json';
import WellAsset from '../assets/buildings/well.json';
import StorehouseAsset from '../assets/buildings/storehouse.json';
import ShrineAsset from '../assets/buildings/shrine.json';
import MageTowerAsset from '../assets/buildings/mage-tower.json';
import PortalAsset from '../assets/buildings/portal.json';
import TavernAsset from '../assets/buildings/tavern.json';
import HostelAsset from '../assets/buildings/hostel.json';
import InnAsset from '../assets/buildings/inn.json';
import GrandInnAsset from '../assets/buildings/grand-inn.json';
import GuildAsset from '../assets/buildings/guild.json';
import GuildHallAsset from '../assets/buildings/guild-hall.json';
import ChapelAsset from '../assets/buildings/chapel.json';
import WeaponsmithAsset from '../assets/buildings/weaponsmith.json';
import ArmorerAsset from '../assets/buildings/armorer.json';
import ApothecaryAsset from '../assets/buildings/apothecary.json';
import PalisadeAsset from '../assets/buildings/palisade.json';
import KeepAsset from '../assets/buildings/keep.json';
import CastleAsset from '../assets/buildings/castle.json';
import TorchAsset from '../assets/buildings/torch.json';
export const BUILDING_ASSETS = {
  Camp: CampAsset,
  Tent: TentAsset,
  Cottage: CottageAsset,
  Townhouse: TownhouseAsset,
  Manor: ManorAsset,
  MarketStalls: MarketStallsAsset,
  MarketHall: MarketHallAsset,
  Bazaar: BazaarAsset,
  Farm: FarmAsset,
  Lumberyard: LumberyardAsset,
  Quarry: QuarryAsset,
  Well: WellAsset,
  Storehouse: StorehouseAsset,
  Shrine: ShrineAsset,
  MageTower: MageTowerAsset,
  Portal: PortalAsset,
  Tavern: TavernAsset,
  Hostel: HostelAsset,
  Inn: InnAsset,
  GrandInn: GrandInnAsset,
  Guild: GuildAsset,
  GuildHall: GuildHallAsset,
  Chapel: ChapelAsset,
  Weaponsmith: WeaponsmithAsset,
  Armorer: ArmorerAsset,
  Apothecary: ApothecaryAsset,
  Palisade: PalisadeAsset,
  Keep: KeepAsset,
  Castle: CastleAsset,
  Torch: TorchAsset,
} satisfies Record<string, BuildingAsset>;
