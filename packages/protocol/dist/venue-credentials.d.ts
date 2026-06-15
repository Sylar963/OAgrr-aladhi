import { z } from 'zod';
import { type VenueId } from './ws.js';
export declare const VenueCredentialFieldKeySchema: z.ZodEnum<["apiKey", "apiSecret", "passphrase", "clientId", "clientSecret", "subaccountId", "account", "walletAddress", "privateKeyPem", "kid", "starknetAccount", "starknetPrivateKey"]>;
export type VenueCredentialFieldKey = z.infer<typeof VenueCredentialFieldKeySchema>;
export declare const VenueCredentialFieldSpecSchema: z.ZodObject<{
    key: z.ZodEnum<["apiKey", "apiSecret", "passphrase", "clientId", "clientSecret", "subaccountId", "account", "walletAddress", "privateKeyPem", "kid", "starknetAccount", "starknetPrivateKey"]>;
    label: z.ZodString;
    placeholder: z.ZodOptional<z.ZodString>;
    secret: z.ZodBoolean;
    required: z.ZodBoolean;
    multiline: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    required: boolean;
    key: "apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey";
    label: string;
    secret: boolean;
    placeholder?: string | undefined;
    multiline?: boolean | undefined;
}, {
    required: boolean;
    key: "apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey";
    label: string;
    secret: boolean;
    placeholder?: string | undefined;
    multiline?: boolean | undefined;
}>;
export type VenueCredentialFieldSpec = z.infer<typeof VenueCredentialFieldSpecSchema>;
export declare const VenuePrivateAdapterStatusSchema: z.ZodEnum<["planned", "in_progress", "available"]>;
export type VenuePrivateAdapterStatus = z.infer<typeof VenuePrivateAdapterStatusSchema>;
export declare const VenuePrivateAdapterSpecSchema: z.ZodObject<{
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>;
    status: z.ZodEnum<["planned", "in_progress", "available"]>;
    wsEndpoint: z.ZodString;
    authScheme: z.ZodEnum<["hmac", "jwt-rs512", "oauth-client-credentials", "eip712", "listen-key", "jwt-starknet"]>;
    positionChannels: z.ZodArray<z.ZodString, "many">;
    subscribeMethod: z.ZodString;
    docsUrl: z.ZodString;
    credentialFields: z.ZodArray<z.ZodObject<{
        key: z.ZodEnum<["apiKey", "apiSecret", "passphrase", "clientId", "clientSecret", "subaccountId", "account", "walletAddress", "privateKeyPem", "kid", "starknetAccount", "starknetPrivateKey"]>;
        label: z.ZodString;
        placeholder: z.ZodOptional<z.ZodString>;
        secret: z.ZodBoolean;
        required: z.ZodBoolean;
        multiline: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        required: boolean;
        key: "apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey";
        label: string;
        secret: boolean;
        placeholder?: string | undefined;
        multiline?: boolean | undefined;
    }, {
        required: boolean;
        key: "apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey";
        label: string;
        secret: boolean;
        placeholder?: string | undefined;
        multiline?: boolean | undefined;
    }>, "many">;
    todos: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    status: "planned" | "in_progress" | "available";
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    wsEndpoint: string;
    authScheme: "hmac" | "jwt-rs512" | "oauth-client-credentials" | "eip712" | "listen-key" | "jwt-starknet";
    positionChannels: string[];
    subscribeMethod: string;
    docsUrl: string;
    credentialFields: {
        required: boolean;
        key: "apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey";
        label: string;
        secret: boolean;
        placeholder?: string | undefined;
        multiline?: boolean | undefined;
    }[];
    todos: string[];
}, {
    status: "planned" | "in_progress" | "available";
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    wsEndpoint: string;
    authScheme: "hmac" | "jwt-rs512" | "oauth-client-credentials" | "eip712" | "listen-key" | "jwt-starknet";
    positionChannels: string[];
    subscribeMethod: string;
    docsUrl: string;
    credentialFields: {
        required: boolean;
        key: "apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey";
        label: string;
        secret: boolean;
        placeholder?: string | undefined;
        multiline?: boolean | undefined;
    }[];
    todos: string[];
}>;
export type VenuePrivateAdapterSpec = z.infer<typeof VenuePrivateAdapterSpecSchema>;
export declare const VenueCredentialsSchema: z.ZodObject<{
    venue: z.ZodEnum<["deribit", "okx", "bybit", "binance", "derive", "coincall", "thalex", "gateio", "paradex"]>;
    label: z.ZodOptional<z.ZodString>;
    fields: z.ZodRecord<z.ZodEnum<["apiKey", "apiSecret", "passphrase", "clientId", "clientSecret", "subaccountId", "account", "walletAddress", "privateKeyPem", "kid", "starknetAccount", "starknetPrivateKey"]>, z.ZodString>;
    addedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    fields: Partial<Record<"apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey", string>>;
    addedAt: number;
    label?: string | undefined;
}, {
    venue: "deribit" | "okx" | "bybit" | "binance" | "derive" | "coincall" | "thalex" | "gateio" | "paradex";
    fields: Partial<Record<"apiKey" | "apiSecret" | "passphrase" | "clientId" | "clientSecret" | "subaccountId" | "account" | "walletAddress" | "privateKeyPem" | "kid" | "starknetAccount" | "starknetPrivateKey", string>>;
    addedAt: number;
    label?: string | undefined;
}>;
export type VenueCredentials = z.infer<typeof VenueCredentialsSchema>;
export declare const PRIVATE_ADAPTER_SPECS: Readonly<Record<VenueId, VenuePrivateAdapterSpec>>;
//# sourceMappingURL=venue-credentials.d.ts.map