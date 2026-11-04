import { pgEnum } from "drizzle-orm/pg-core";

/** Жизненный цикл объекта сети: проект → построено → выведено. */
export const objectStatus = pgEnum("object_status", ["planned", "built", "decommissioned"]);

export const memberRole = pgEnum("member_role", ["owner", "admin", "designer", "technician", "viewer"]);

/** Физическое место на карте. */
export const siteKind = pgEnum("site_kind", [
  "pop", // узел связи
  "pole", // опора
  "manhole", // колодец
  "cabinet", // уличный шкаф
  "building", // здание
  "entrance", // подъезд / ввод в здание
  "point", // произвольная точка (стена, крюк и т.п.)
]);

/** Вид трассы (инфраструктуры, по которой идёт кабель). */
export const routeKind = pgEnum("route_kind", ["aerial", "duct", "ground", "facade", "indoor"]);

export const cableConstruction = pgEnum("cable_construction", ["aerial", "duct", "ground", "indoor", "drop"]);

export const equipmentKind = pgEnum("equipment_kind", [
  "closure", // муфта
  "terminal_box", // абонентский ящик ОРК / FAT
  "odf", // оптический кросс
  "splitter",
  "olt",
  "onu",
]);

export const terminalKind = pgEnum("terminal_kind", ["fiber_end", "port"]);
export const fiberSide = pgEnum("fiber_side", ["a", "b"]);
/** in/out — сплиттер; adapter — порт кросса/ящика; pon — порт OLT или ONU. */
export const portRole = pgEnum("port_role", ["in", "out", "adapter", "pon"]);
/** Сторона адаптера: rear — под сварку пигтейла, front — под патч-корд/дроп. */
export const portFace = pgEnum("port_face", ["rear", "front"]);

export const connectionKind = pgEnum("connection_kind", [
  "fusion", // сварка
  "mechanical", // механический сплайс
  "patch", // коннекторное соединение / патч-корд
  "through", // волокно проходит муфту транзитом, не разрезано
]);

export const fiberCondition = pgEnum("fiber_condition", ["ok", "damaged", "reserved"]);
