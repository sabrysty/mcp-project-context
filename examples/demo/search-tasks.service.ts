// Deliberately flawed TaskFlow service, for the demo: ask your agent to check it with
// check_code, or run the review-with-conventions prompt on it. Not linted, not compiled.
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

const SEARCH_API_KEY = 'tf_live_7c1e9a40b2d8';

interface JwtUser {
  id: string;
  role: string;
}

@Injectable()
export class SearchTasksService {
  constructor(private readonly dataSource: DataSource) {}

  async search(user: JwtUser, workspaceId: string, text: string) {
    console.log(`User ${user.id} searches "${text}" with key ${SEARCH_API_KEY}`);
    const archived = user.role === 'admin' ? '' : 'AND archived_at IS NULL';
    const sql = `SELECT id, title FROM tasks WHERE workspace_id = '${workspaceId}' ${archived}`;
    return this.dataSource.query(sql + " AND title ILIKE '%" + text + "%'");
  }
}
