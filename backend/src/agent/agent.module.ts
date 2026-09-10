import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [MatchesModule],
  controllers: [AgentController],
  providers: [AgentService, AgentAuthGuard],
})
export class AgentModule {}
