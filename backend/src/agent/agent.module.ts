import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentEnrollController } from './agent-enroll.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { MatchesModule } from '../matches/matches.module';
import { CamerasModule } from '../cameras/cameras.module';

@Module({
  imports: [MatchesModule, CamerasModule],
  controllers: [AgentController, AgentEnrollController],
  providers: [AgentService, AgentAuthGuard],
})
export class AgentModule {}
