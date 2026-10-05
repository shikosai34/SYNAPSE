// 2026-10-03: POS と来場者画面で共有するカートの規則を UI から分離する。
// 同一商品のトッピング違いは別行、トッピングの選択順だけが違う場合は同じ行として扱う。
export interface CartTopping {
  toppingId: string;
  toppingName: string;
  toppingPrice: number;
}
export interface CartLine {
  lineId: string;
  menuId: string;
  menuName: string;
  menuPrice: number;
  quantity: number;
  toppings: CartTopping[];
}

type CartMenu = { id: string; name: string; price: number };
type CartMenuTopping = { id: string; name: string; price: number };

export const lineKey = (menuId: string, toppingIds: string[]) =>
  JSON.stringify([menuId, [...toppingIds].sort()]);

export const lineSubtotal = (line: CartLine) =>
  (line.menuPrice + line.toppings.reduce((sum, topping) => sum + topping.toppingPrice, 0)) * line.quantity;
export const cartTotal = (cart: CartLine[]) => cart.reduce((sum, line) => sum + lineSubtotal(line), 0);
export const cartCount = (cart: CartLine[]) => cart.reduce((sum, line) => sum + line.quantity, 0);

export function addCartLine(cart: CartLine[], menu: CartMenu, toppings: CartTopping[], newId = () => crypto.randomUUID()): CartLine[] {
  const key = lineKey(menu.id, toppings.map((topping) => topping.toppingId));
  const existing = cart.find((line) => lineKey(line.menuId, line.toppings.map((topping) => topping.toppingId)) === key);
  if (existing) return cart.map((line) => line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line);
  return [...cart, { lineId: newId(), menuId: menu.id, menuName: menu.name, menuPrice: menu.price, quantity: 1, toppings }];
}

export function updateCartQuantity(cart: CartLine[], lineId: string, delta: number): CartLine[] {
  return cart.map((line) => line.lineId === lineId ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line)
    .filter((line) => line.quantity > 0);
}

export function toggleCartTopping(cart: CartLine[], lineId: string, topping: CartMenuTopping): CartLine[] {
  return cart.map((line) => {
    if (line.lineId !== lineId) return line;
    const selected = line.toppings.some((item) => item.toppingId === topping.id);
    return { ...line, toppings: selected
      ? line.toppings.filter((item) => item.toppingId !== topping.id)
      : [...line.toppings, { toppingId: topping.id, toppingName: topping.name, toppingPrice: topping.price }] };
  });
}
