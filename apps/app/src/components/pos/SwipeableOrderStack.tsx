import { useState, useRef, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Users, CheckCircle, XCircle } from "lucide-react";

export interface SwipeableOrder {
  id: string;
  orderNumber: string;
  createdAt: string | Date | null;
  status: string;
  totalPrice?: number;
  items: Array<{
    id: string;
    menuName: string;
    quantity: number;
    menuPrice?: number;
    toppings?: Array<{
      id: string;
      toppingName: string;
      price: number;
    }>;
  }>;
}

interface SwipeableOrderStackProps {
  orders: SwipeableOrder[];
  onComplete: (id: string) => void;
  onCancelRequest: (id: string, orderNumber: string) => void;
}

const SWIPE_THRESHOLD = 100; // px
const ROTATION_MULTIPLIER = 0.05; // degrees per px

function formatDate(date: string | Date | null) {
  if (!date) return "-";
  return new Date(date).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SwipeableCard({
  order,
  isTop,
  index,
  onSwipeLeft,
  onSwipeRight,
  forceHidden,
}: {
  order: SwipeableOrder;
  isTop: boolean;
  index: number;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  forceHidden: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const currentX = useRef(0);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    if (!forceHidden && exitDirection) {
      // If parent brought it back (e.g. cancelled the cancel dialog)
      setExitDirection(null);
      setOffset(0);
    }
  }, [forceHidden, exitDirection]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isTop || exitDirection) return;
    startX.current = e.clientX;
    currentX.current = e.clientX;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !isTop) return;
    currentX.current = e.clientX;
    setOffset(currentX.current - startX.current);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging || !isTop) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (offset > SWIPE_THRESHOLD) {
      // Swiped Right (Complete)
      setExitDirection("right");
      onSwipeRight();
    } else if (offset < -SWIPE_THRESHOLD) {
      // Swiped Left (Cancel)
      setExitDirection("left");
      onSwipeLeft();
    } else {
      // Spring back
      setOffset(0);
    }
  };

  if (forceHidden && !exitDirection) {
    return null;
  }

  let finalOffset = offset;
  let finalRotate = offset * ROTATION_MULTIPLIER;
  let transition = isDragging ? "none" : "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease-out";
  let opacity = isTop ? 1 : 1 - index * 0.15;

  if (exitDirection === "right") {
    finalOffset = window.innerWidth;
    finalRotate = 30;
    opacity = 0;
  } else if (exitDirection === "left") {
    finalOffset = -window.innerWidth;
    finalRotate = -30;
    opacity = 0;
  }

  const scale = isTop ? 1 : Math.max(0.9, 1 - index * 0.05);
  const translateY = isTop ? 0 : index * 12;

  const style: React.CSSProperties = {
    transform: `translateX(${finalOffset}px) translateY(${translateY}px) scale(${scale}) rotate(${finalRotate}deg)`,
    transition,
    zIndex: 100 - index,
    position: index === 0 && !exitDirection ? "relative" : "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity,
    pointerEvents: isTop ? "auto" : "none",
    touchAction: "none", // Prevent pull-to-refresh and scrolling while dragging
    userSelect: "none",
    boxShadow: isTop ? "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)" : "none",
  };

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: any }> = {
      pending: { label: "未着手", variant: "default" },
      preparing: { label: "調理中", variant: "warning" },
      ready: { label: "受渡可", variant: "active" },
      completed: { label: "完成", variant: "active" },
      cancelled: { label: "キャンセル", variant: "error" },
    };
    const config = statusConfig[status] || { label: status, variant: "default" };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <Card
      className={`rounded-none border-thick border-border w-full bg-background origin-bottom`}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Background hint for swipe direction */}
      {isTop && isDragging && offset !== 0 && (
        <div
          className={`absolute inset-0 z-0 flex items-center justify-center opacity-10 pointer-events-none transition-opacity duration-150`}
        >
          {offset > 0 ? (
            <CheckCircle className="w-32 h-32 text-green-500" />
          ) : (
            <XCircle className="w-32 h-32 text-red-500" />
          )}
        </div>
      )}

      <div className="relative z-10 bg-background">
        <CardHeader className="pb-3 border-b-thin border-border">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl sm:text-3xl font-headline uppercase">
                #{order.orderNumber}
              </CardTitle>
              <CardDescription className="flex items-center gap-3 mt-2">
                <span className="flex items-center font-mono text-sm">
                  <Clock className="mr-1.5 h-4 w-4" />
                  {formatDate(order.createdAt)}
                </span>
                <span className="flex items-center font-mono text-sm">
                  <Users className="mr-1.5 h-4 w-4" />
                  {order.items.length}品
                </span>
              </CardDescription>
            </div>
            {getStatusBadge(order.status)}
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="border-thin border-border p-3 bg-muted/20">
                <div className="flex justify-between items-center gap-2">
                  <span className="font-bold text-lg">
                    {item.menuName} <span className="text-muted-foreground ml-1">x{item.quantity}</span>
                  </span>
                </div>
                {item.toppings && item.toppings.length > 0 && (
                  <div className="mt-2 pl-2 border-l-2 border-border space-y-1">
                    {item.toppings.map((topping) => (
                      <div key={topping.id} className="text-sm font-mono text-muted-foreground">
                        + {topping.toppingName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t-thick border-border pt-4 flex justify-between font-headline text-2xl">
            <span>合計</span>
            <span>¥{(order.totalPrice ?? 0).toLocaleString()}</span>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 pt-0 px-4 pb-4 bg-background">
          <div className="text-center w-full text-sm font-mono text-muted-foreground py-2 border-t-thin border-border flex justify-between px-2">
            <span className="flex items-center"><XCircle className="w-4 h-4 mr-1"/>左へ: キャンセル</span>
            <span className="flex items-center">右へ: 完成<CheckCircle className="w-4 h-4 ml-1"/></span>
          </div>
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1 h-14 border-thick border-destructive text-destructive rounded-none font-mono uppercase font-bold"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSwipeLeft();
              }}
            >
              <XCircle className="mr-2 h-5 w-5" /> キャンセル
            </Button>
            <Button
              variant="default"
              className="flex-1 h-14 border-thick border-border rounded-none font-mono uppercase font-bold bg-green-600 hover:bg-green-700 text-white"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSwipeRight();
              }}
            >
              <CheckCircle className="mr-2 h-5 w-5" /> 完成
            </Button>
          </div>
        </CardFooter>
      </div>
    </Card>
  );
}

export function SwipeableOrderStack({ orders, onComplete, onCancelRequest }: SwipeableOrderStackProps) {
  const [swipedRightIds, setSwipedRightIds] = useState<Set<string>>(new Set());

  // Cleanup swiped right IDs when they are no longer in the orders array
  useEffect(() => {
    const currentOrderIds = new Set(orders.map((o) => o.id));
    setSwipedRightIds((prev) => {
      const next = new Set(prev);
      for (const id of next) {
        if (!currentOrderIds.has(id)) {
          next.delete(id);
        }
      }
      return next;
    });
  }, [orders]);

  const visibleOrders = useMemo(() => {
    return orders.filter((o) => !swipedRightIds.has(o.id));
  }, [orders, swipedRightIds]);

  if (orders.length === 0) {
    return (
      <Card className="rounded-none border-thick border-border border-dashed">
        <CardContent className="py-24 flex flex-col items-center justify-center">
          <CheckCircle className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <p className="text-center font-headline text-2xl text-muted-foreground uppercase">
            NO ORDERS
          </p>
          <p className="text-center font-mono text-muted-foreground text-sm mt-2">
            調理中の注文はありません
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative w-full max-w-md mx-auto h-[600px] perspective-1000">
      {visibleOrders.slice(0, 3).reverse().map((order, reversedIndex, array) => {
        const index = array.length - 1 - reversedIndex;
        const isTop = index === 0;

        return (
          <SwipeableCard
            key={order.id}
            order={order}
            isTop={isTop}
            index={index}
            forceHidden={swipedRightIds.has(order.id)}
            onSwipeRight={() => {
              setSwipedRightIds((prev) => new Set(prev).add(order.id));
              onComplete(order.id);
            }}
            onSwipeLeft={() => {
              // Note: We don't hide it immediately on left swipe because it might be aborted by the confirm dialog.
              onCancelRequest(order.id, order.orderNumber);
            }}
          />
        );
      })}
    </div>
  );
}
