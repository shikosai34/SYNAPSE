import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function extractIdFromCode(code: string): string {
	const trimmed = code.trim();
	// http://localhost:3001/w/usr_xxxx などの URL から ID を抽出する
	const match = trimmed.match(/\/w\/([a-zA-Z0-9_\-]+)/);
	if (match && match[1]) {
		return match[1];
	}
	return trimmed;
}
