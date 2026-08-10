import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export type Item = {
  id: string;
  name: string;
  createdAt: string;
};

const client = new DynamoDBClient({
  region: process.env.DYNAMODB_REGION || "us-east-2",
});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.DYNAMODB_TABLE || "hot-takes-items";

export async function listItems(): Promise<Item[]> {
  const result = await docClient.send(new ScanCommand({ TableName: TABLE }));
  return (result.Items as Item[]) || [];
}

export async function createItem(name: string): Promise<Item> {
  const item: Item = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}
