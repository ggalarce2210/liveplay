import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ComplexesController } from './complexes.controller';
import { ComplexesService } from './complexes.service';

@Module({
  // Hace falta JwtService en el controller para decodificar (a mano, sin @UseGuards) el JWT
  // opcional que acota /complexes y /complexes/:id a un solo complejo cuando lo llama un
  // COMPLEX_ADMIN — ver el comentario grande en ComplexesController.getScopedComplexId. No se
  // pasa secret acá porque se lee de ConfigService recién al verificar cada token.
  imports: [JwtModule.register({})],
  controllers: [ComplexesController],
  providers: [ComplexesService],
  exports: [ComplexesService],
})
export class ComplexesModule {}
